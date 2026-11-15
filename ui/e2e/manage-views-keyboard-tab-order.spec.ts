import { test, expect, type Page } from '@playwright/test';
import { build, type Plugin, type Rollup } from 'vite';
import os from 'node:os';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * KEYBOARD pin for the Manage Views dialog: Tab and Shift+Tab walk every stop
 * of every view row, past the rows' tooltip-carrying Pin and Set-as-default
 * buttons (objectstack#33980).
 *
 * ## The defect
 *
 * A row's Pin and Set-as-default buttons are tooltip triggers, and
 * `TooltipContent` mounts inline, inside the dialog. Tab onto Pin opens its
 * tooltip; the next Tab blurs Pin, the tooltip closes and its content
 * unmounts. A browser runs microtasks between the blur and the focus of a
 * native focus move, with `document.activeElement` on `body`, and the
 * dialog's focus trap (Radix `FocusScope`) read "a node under the trap was
 * removed while focus is on body" as "the focused element was removed", so it
 * focused the dialog container and the browser abandoned the move. The walk
 * stopped after the first row's Pin: every later row, its menus and Done were
 * unreachable by keyboard. The Console ships no exit animation for tooltips
 * (its stylesheet leaves `tailwindcss-animate` out), so the content unmounts
 * at once, inside that gap.
 *
 * The fix is the trap's, not the dialog's:
 * `patches/@radix-ui__react-focus-scope.patch` (repository root) refocuses
 * the container only when the last focused element is no longer inside it.
 * The import wizard's keyboard spec pins the same class at a second site.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * The microtask checkpoint between blur and focus exists only in a native
 * focus move; `user-event`'s Tab moves focus with a scripted `.focus()`. Here
 * the keys are Chromium's own (`page.keyboard.press`) and nothing calls
 * `.focus()`. The trap's decision itself is unit-pinned beside the other
 * focus-scope patch cases, in `@object-ui/components`'
 * `dialog-popover-focus-scope.test.tsx`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `ManageViewsDialog` and everything it imports, bundled by Vite from
 * their source files (each `@object-ui/*` package resolved to its `src/`),
 * mounted in Chromium with React's client renderer, with the callbacks the
 * Console's object view wires (rename, delete, set default, pin, reorder).
 *
 * FIXTURES: two views, the default `All` and a user view `Mine`; the CONTROL
 * marks both read-only, so no row draws a tooltip trigger. No stylesheet,
 * as in the Console's tooltips: no exit animation.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const MANAGE_VIEWS_DIALOG = source('packages/plugin-view/src/ManageViewsDialog.tsx');
// By path, the module `@object-ui/i18n` resolves to below, so this file holds
// no import statement naming a workspace package (the premise
// `scripts/__tests__/e2e-type-check.test.ts` pins for `e2e/`).
const I18N_ENTRY = source('packages/i18n/src/index.ts');

const ORIGIN = 'http://manage-views-tab-order.test';
const ENTRY = '\0manage-views-tab-order:entry';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'manage-views-tab-order-workspace-src',
    enforce: 'pre',
    async resolveId(id, importer) {
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
  };
}

/** The page: one open dialog over the views the test put on `window`. */
function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from ${JSON.stringify(I18N_ENTRY)};
import { ManageViewsDialog } from ${JSON.stringify(MANAGE_VIEWS_DIALOG)};

const noop = () => {};
const h = React.createElement;
createRoot(document.getElementById('root')).render(
  h(I18nProvider, { config: { defaultLanguage: 'en', detectBrowserLanguage: false } },
    h(ManageViewsDialog, {
      open: true,
      onOpenChange: noop,
      views: window.__VIEWS,
      activeViewId: 'all',
      onRename: noop,
      onDelete: noop,
      onSetDefault: noop,
      onSetPinned: noop,
      onReorder: noop,
    })),
);
`;
  return {
    name: 'manage-views-tab-order-entry',
    resolveId: (id) => (id === 'manage-views-tab-order:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-manage-views-tab-order'),
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
      rollupOptions: {
        input: 'manage-views-tab-order:entry',
        output: { format: 'es', codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunks = outputs.flatMap((o) => o.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`expected one bundled chunk, got ${chunks.length}`);
  return chunks[0].code;
}

let bundle = '';

interface ViewFixture {
  id: string;
  label: string;
  type: string;
  isDefault?: boolean;
  readonly?: boolean;
}

/**
 * Open the dialog over `views` at a real origin, wait for the search box,
 * and click the dialog title so the dialog itself holds focus.
 */
async function mount(page: Page, views: ViewFixture[]): Promise<void> {
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((list) => {
    (window as unknown as { __VIEWS: ViewFixture[] }).__VIEWS = list;
  }, views);
  await page.addScriptTag({ content: bundle, type: 'module' });
  await expect(page.getByTestId('manage-views-search')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('dialog').getByRole('heading').click();
  await expect(page.getByRole('dialog')).toBeFocused();
}

/**
 * The focused element, named the way the expectations below spell a stop:
 * `dialog` for the dialog container; its test id; `view:<label>` for a row's
 * name button (its `title` is the view's label); otherwise its accessible
 * name or text.
 */
function focusedStop(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    if (el.getAttribute('role') === 'dialog') return 'dialog';
    const id = el.getAttribute('data-testid');
    if (id) return id;
    const title = el.getAttribute('title');
    if (title) return `view:${title}`;
    return (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim();
  });
}

/** Press `key` `times` times, naming the focused stop after each press. */
async function walk(page: Page, key: 'Tab' | 'Shift+Tab', times: number): Promise<string[]> {
  const trail: string[] = [];
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    trail.push(await focusedStop(page));
  }
  return trail;
}

test.beforeAll(async () => {
  // Bundling the dialog's module graph is the slow part; once per worker.
  test.setTimeout(240_000);
  bundle = await bundlePage();
});

const CASES = [
  {
    name: 'two editable views: every row stop, past each Pin and Set-as-default',
    views: [
      { id: 'all', label: 'All', type: 'grid', isDefault: true },
      { id: 'mine', label: 'Mine', type: 'grid' },
    ],
    stops: [
      'manage-views-search',
      'manage-views-drag-all',
      'view:All',
      'manage-views-pin-all',
      'manage-views-actions-all',
      'manage-views-drag-mine',
      'view:Mine',
      'manage-views-pin-mine',
      'manage-views-default-mine',
      'manage-views-actions-mine',
      'manage-views-done',
      'Close',
    ],
  },
  {
    name: 'CONTROL — read-only views: no row draws a tooltip trigger',
    views: [
      { id: 'all', label: 'All', type: 'grid', isDefault: true, readonly: true },
      { id: 'mine', label: 'Mine', type: 'grid', readonly: true },
    ],
    stops: [
      'manage-views-search',
      'manage-views-drag-all',
      'view:All',
      'manage-views-drag-mine',
      'view:Mine',
      'manage-views-done',
      'Close',
    ],
  },
] as const;

test.describe('manage views dialog — Tab walks every row stop in DOM order (objectstack#33980)', () => {
  for (const c of CASES) {
    test(`${c.name}`, async ({ page }) => {
      await mount(page, [...c.views]);
      const stops = [...c.stops];

      // Forward: every stop once, in order, then the trap loops to the first.
      expect(await walk(page, 'Tab', stops.length + 1)).toEqual([...stops, stops[0]]);

      // Backward from the first stop: the trap loops to the last, then every
      // stop once in reverse order.
      expect(await walk(page, 'Shift+Tab', stops.length)).toEqual([...stops].reverse());
    });
  }
});
