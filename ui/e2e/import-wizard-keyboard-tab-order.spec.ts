import { test, expect, type Page } from '@playwright/test';
import { build, type Plugin, type Rollup } from 'vite';
import os from 'node:os';
import path from 'node:path';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * KEYBOARD pin for the import wizard's mapping step: Tab and Shift+Tab walk
 * every stop of the dialog in DOM order, including the focusable wrapper that
 * carries a disabled control's reason (objectstack#33862).
 *
 * ## The defect
 *
 * With no column mapped, "Save current" is disabled and a `tabIndex={0}` span
 * around it is the tab stop and the trigger of a tooltip giving the reason.
 * Focusing that span opens the tooltip, and the tooltip's content was mounted
 * inline, inside the dialog. Pressing Tab blurs the span, the tooltip closes
 * and its content unmounts. A browser runs microtasks between the blur and the
 * focus of a native focus move, with `document.activeElement` on `body`, and
 * the dialog's focus trap (Radix `FocusScope`) reads "a node under the trap
 * was removed while focus is on body" as "the focused element was removed",
 * so it focuses the dialog container and the browser abandons the move. The
 * next Tab lands on the first stop again: the cycle was template select,
 * reason span, dialog container. The trap now refocuses its container only
 * when the last focused element is no longer inside it
 * (`patches/@radix-ui__react-focus-scope.patch` at the repository root), so
 * the tooltip may unmount inline, under the trap, with Tab still moving on.
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * The microtask checkpoint between blur and focus exists only in a native
 * focus move. `user-event`'s Tab, in happy-dom or jsdom, moves focus with a
 * scripted `.focus()` call, and microtasks queued inside it run only after it
 * returns, by when focus already sits on the next stop: the defect walks all
 * eight stops there, so a vitest pin of this cannot fail. Here the keys are
 * Chromium's own (`page.keyboard.press`) and nothing calls `.focus()`; the
 * walk starts with a mouse click on the dialog title, which focuses the
 * dialog the way a user's click does.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `ImportWizard` and everything it imports, bundled by Vite from their
 * source files (each `@object-ui/*` package resolved to its `src/`), mounted in
 * Chromium with React's client renderer, opened on a CSV file through its
 * `initialFile` prop so it parses and maps the file itself.
 *
 * FIXTURES: two required text fields, `title` and `project`, and a data source
 * offering no optional import capability. No stylesheet: the walk reads focus,
 * not layout. The three files mirror the card's repro and controls: nothing
 * mapped (both reasons drawn), all mapped (no reason drawn), and one required
 * field unmapped (only Next's reason drawn).
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const IMPORT_WIZARD = source('packages/plugin-grid/src/ImportWizard.tsx');
// By path, the module `@object-ui/i18n` resolves to below, so this file holds
// no import statement naming a workspace package (the premise
// `scripts/__tests__/e2e-type-check.test.ts` pins for `e2e/`).
const I18N_ENTRY = source('packages/i18n/src/index.ts');

const ORIGIN = 'http://import-wizard-tab-order.test';
const ENTRY = '\0import-wizard-tab-order:entry';

/** The disabled "Save current" reason, as the English bundle words it. */
const SAVE_REASON = 'Map at least one column to save a template.';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'import-wizard-tab-order-workspace-src',
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

/** The page: one wizard, opened on the CSV text the test put on `window`. */
function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from ${JSON.stringify(I18N_ENTRY)};
import { ImportWizard } from ${JSON.stringify(IMPORT_WIZARD)};

const FIELDS = [
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'project', label: 'Project', type: 'text', required: true },
];
const file = new File([window.__IMPORT_CSV], 'rows.csv', { type: 'text/csv' });

const h = React.createElement;
createRoot(document.getElementById('root')).render(
  h(I18nProvider, { config: { defaultLanguage: 'en', detectBrowserLanguage: false } },
    h(ImportWizard, {
      objectName: 'task',
      objectLabel: 'Task',
      fields: FIELDS,
      dataSource: {},
      open: true,
      onOpenChange: () => {},
      initialFile: file,
    })),
);
`;
  return {
    name: 'import-wizard-tab-order-entry',
    resolveId: (id) => (id === 'import-wizard-tab-order:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-import-wizard-tab-order'),
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
        input: 'import-wizard-tab-order:entry',
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

/**
 * Open the wizard on `csv` at a real origin (the template bar reads
 * `localStorage`, which an `about:blank` page refuses), wait for the mapping
 * step, and click the dialog title so the dialog itself holds focus.
 */
async function mount(page: Page, csv: string): Promise<void> {
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.evaluate((text) => {
    (window as unknown as { __IMPORT_CSV: string }).__IMPORT_CSV = text;
  }, csv);
  await page.addScriptTag({ content: bundle, type: 'module' });
  await expect(page.getByTestId('import-template-select')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('dialog').getByRole('heading').click();
  await expect(page.getByRole('dialog')).toBeFocused();
}

/**
 * The focused element, named the way the expectations below spell a stop:
 * its test id; `reason:<id>` for the wrapper carrying a disabled button's
 * reason; `map:<header>` for a column's mapping select; `dialog` for the
 * dialog container; otherwise its accessible text.
 */
function focusedStop(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    if (el.getAttribute('role') === 'dialog') return 'dialog';
    if (el.hasAttribute('data-disabled-reason')) {
      return `reason:${el.querySelector('button[data-testid]')?.getAttribute('data-testid') ?? '?'}`;
    }
    const id = el.getAttribute('data-testid');
    if (id) return id;
    const row = el.closest('tr');
    if (row && el.getAttribute('role') === 'combobox') {
      return `map:${row.querySelector('td span')?.textContent?.trim() ?? '?'}`;
    }
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
  // Bundling the wizard's module graph is the slow part; once per worker.
  test.setTimeout(240_000);
  bundle = await bundlePage();
});

const CASES = [
  {
    name: 'nothing mapped: both reason wrappers are stops',
    csv: 'foo,bar\nx,1\n',
    stops: [
      'import-template-select',
      'reason:import-template-save-btn',
      'map:foo',
      'map:bar',
      'Cancel',
      'Back',
      'reason:import-next-btn',
      'Close',
    ],
  },
  {
    name: 'CONTROL — everything mapped: no reason is drawn',
    csv: 'title,project\nx,1\n',
    stops: [
      'import-template-select',
      'import-template-save-btn',
      'map:title',
      'map:project',
      'Cancel',
      'Back',
      'import-next-btn',
      'Close',
    ],
  },
  {
    name: 'CONTROL — one required field unmapped: only Next gives a reason',
    csv: 'title,foo\nx,1\n',
    stops: [
      'import-template-select',
      'import-template-save-btn',
      'map:title',
      'map:foo',
      'Cancel',
      'Back',
      'reason:import-next-btn',
      'Close',
    ],
  },
] as const;

test.describe('import wizard mapping step — Tab walks every stop in DOM order (objectstack#33862)', () => {
  for (const c of CASES) {
    test(`${c.name}`, async ({ page }) => {
      await mount(page, c.csv);
      const stops = [...c.stops];

      // Forward: every stop once, in order, then the trap loops to the first.
      expect(await walk(page, 'Tab', stops.length + 1)).toEqual([...stops, stops[0]]);

      // Backward from the first stop: the trap loops to the last, then every
      // stop once in reverse order.
      expect(await walk(page, 'Shift+Tab', stops.length)).toEqual([...stops].reverse());
    });
  }

  test('the Save-current reason is reached by keyboard and read out in its tooltip', async ({ page }) => {
    await mount(page, 'foo,bar\nx,1\n');
    expect(await walk(page, 'Tab', 2)).toEqual(['import-template-select', 'reason:import-template-save-btn']);
    await expect(page.getByRole('tooltip')).toHaveText(SAVE_REASON);
    // And the reason does not hold focus: the next Tab goes on to the first
    // mapping select.
    expect(await walk(page, 'Tab', 1)).toEqual(['map:foo']);
  });
});
