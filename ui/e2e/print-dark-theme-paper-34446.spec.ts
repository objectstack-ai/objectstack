import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * objectstack#34446 — a page printed from the Console in the dark theme, with
 * "Background graphics" on, printed a dark sheet.
 *
 * ## The defect
 *
 * The theme's `.dark { color-scheme: dark }` (`@object-ui/components`
 * index.css) also darkens the CANVAS: the colour the browser paints under a
 * transparent root. On paper the canvas fills the whole sheet, the `@page`
 * margin band included, and the app-shell print rules leave every box
 * transparent in the dark theme. Measured on a running Console (showcase, A4
 * record print page and the invoice list, `page.pdf({ printBackground: true })`
 * read back with `pdftoppm`): the 12 mm margin band printed rgb(18, 18, 18)
 * round the print page, and the list printed its black text on an
 * rgb(18, 18, 18) sheet. The fix, rule 7 of the print block in
 * `packages/app-shell/src/styles.css`, gives `.dark` a light colour scheme on
 * paper only.
 *
 * ## What is real here
 *
 * The stylesheet is the Console's own production CSS, read from the build
 * under test (`apps/console/dist`, the build `playwright.config.ts` serves);
 * the document is a bare page with `class="dark"` or `class="light"` on the
 * root, the way `ThemeProvider` sets it. Chromium writes the PDF. Its first
 * page's content stream is read for the rectangle that covers the whole sheet
 * (`0 0 816 1056 re f`, US Letter in CSS pixels): Chromium paints the canvas
 * with exactly that operator when the canvas is not white, and paints nothing
 * when it is. Reading the operator needs no rasteriser on the CI runner.
 *
 * Chromium only: `page.pdf` exists in Chromium alone, and the CI lane runs
 * `--project=chromium`.
 */

const DIST = path.resolve(import.meta.dirname, '../apps/console/dist');
/** US Letter in CSS pixels: the sheet `page.pdf({ format: 'Letter' })` lays out. */
const SHEET = '0 0 816 1056 re';

/** The Console's production stylesheets, in the order its document links them. */
function consoleCss(): string {
  const index = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const hrefs = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
  // Non-vacuity: no stylesheet would make every assertion below hold vacuously.
  expect(hrefs.length).toBeGreaterThan(0);
  return hrefs
    .map((href) => fs.readFileSync(path.join(DIST, 'assets', path.basename(href)), 'utf8'))
    .join('\n');
}

/**
 * The fill colours (`r g b`) of every rectangle that covers the whole sheet,
 * read from the PDF's decompressed content streams.
 */
function sheetFills(pdf: Buffer): string[] {
  const fills: string[] = [];
  const raw = pdf.toString('latin1');
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index ?? 0) + m[0].length;
    const end = raw.indexOf('endstream', start);
    let ops: string;
    try {
      ops = zlib.inflateSync(pdf.subarray(start, end)).toString('latin1');
    } catch {
      continue; // not a Flate stream (fonts, images)
    }
    let at = ops.indexOf(SHEET);
    while (at !== -1) {
      const before = ops.slice(0, at);
      const colour = [...before.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].pop();
      if (colour) fills.push(`${colour[1]} ${colour[2]} ${colour[3]}`);
      at = ops.indexOf(SHEET, at + SHEET.length);
    }
  }
  return fills;
}

const WHITE = '1 1 1';

async function printed(page: Page, html: string): Promise<{ fills: string[]; screenScheme: string; printScheme: string }> {
  await page.setContent(html);
  const screenScheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  await page.emulateMedia({ media: 'print' });
  const printScheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  return { fills: sheetFills(pdf), screenScheme, printScheme };
}

const doc = (theme: 'dark' | 'light', css: string) =>
  `<!doctype html><html class="${theme}"><head><style>${css}</style></head>` +
  '<body><main><h1>Invoice INV-1008</h1><p>Printed text</p></main></body></html>';

test.describe('objectstack#34446 — the dark theme prints on a white sheet', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'page.pdf is Chromium-only; the CI E2E project is chromium');

  test('the reader sees a dark canvas when one is painted (control for the reader)', async ({ page }) => {
    // Without this, a reader that never matches would pass the white-sheet
    // assertions below for the wrong reason.
    const { fills } = await printed(page, '<!doctype html><html style="color-scheme: dark"><body><p>x</p></body></html>');
    expect(fills).toEqual(['.0706 .0706 .0706']);
  });

  test('dark theme: the sheet, margin band included, prints white; the screen stays dark', async ({ page }) => {
    const { fills, screenScheme, printScheme } = await printed(page, doc('dark', consoleCss()));
    expect(fills.filter((f) => f !== WHITE)).toEqual([]);
    expect(printScheme).toBe('light');
    expect(screenScheme).toBe('dark');
  });

  test('light theme (control): prints white, as it always did', async ({ page }) => {
    const { fills, screenScheme, printScheme } = await printed(page, doc('light', consoleCss()));
    expect(screenScheme).toBe('light');
    expect(printScheme).toBe('light');
    expect(fills.filter((f) => f !== WHITE)).toEqual([]);
  });
});
