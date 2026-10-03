#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// render-hero-cover — screenshot `hero-cover-dark.html` at 2400 x 1200 into the
// committed PNG master, then derive the docs site's WebP from that PNG.
//
//   node docs/screenshots/render-hero-cover.mjs              # write both committed files
//   node docs/screenshots/render-hero-cover.mjs --out <dir>  # preview into <dir>, touch nothing committed
//   node docs/screenshots/render-hero-cover.mjs --png-only   # skip the webp derivation
//
// Only packages the repository already holds are used, resolved from the
// packages that declare them rather than installed again: Playwright's
// `chromium` from `examples/app-showcase` (`@playwright/test`), and `sharp`
// from the docs app's Next dependency. The browser binary is the preinstalled
// one under `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`) — this
// script never runs `playwright install`.
//
// Two refusals, both loud, because a cover that silently rendered wrong would
// ship to every README reader and every social unfurl:
//   - the web fonts (Inter, IBM Plex Mono) must have loaded — an offline render
//     falls back to the system sans and is refused unless `--out` names a
//     preview directory;
//   - the screenshot must measure exactly 2400 x 1200, the size `HERO_COVER` in
//     `apps/docs/lib/site.ts` declares as og:image:width / og:image:height.
//
// The webp recipe is the one the `HERO_COVER` provenance block records:
// quality 80, effort 6, from the PNG master and never from a previous webp.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const TEMPLATE = join(HERE, 'hero-cover-dark.html');
const PNG = join(HERE, 'hero-cover-dark.png');
const WEBP = join(REPO, 'apps', 'docs', 'public', 'hero-cover-dark.webp');
const WIDTH = 2400;
const HEIGHT = 1200;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outDir = opt('--out');
const pngOnly = flag('--png-only');
const pngOut = outDir ? join(outDir, 'hero-cover-dark.png') : PNG;
const webpOut = outDir ? join(outDir, 'hero-cover-dark.webp') : WEBP;
if (outDir) mkdirSync(outDir, { recursive: true });

const playwrightRequire = createRequire(join(REPO, 'examples', 'app-showcase', 'package.json'));
const { chromium } = playwrightRequire('@playwright/test');
const nextManifest = createRequire(join(REPO, 'apps', 'docs', 'package.json')).resolve('next/package.json');
const sharp = createRequire(nextManifest)('sharp');

const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const executablePath = join(browsersPath, 'chromium');
if (!existsSync(executablePath)) {
  console.error(`✗ no preinstalled Chromium at ${executablePath} — set PLAYWRIGHT_BROWSERS_PATH; this script never runs playwright install`);
  process.exit(2);
}

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const browser = await chromium.launch({
  executablePath,
  args: ['--font-render-hinting=none', '--disable-gpu'],
  ...(proxy ? { proxy: { server: proxy } } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: Boolean(proxy),
  });
  await page.goto(pathToFileURL(TEMPLATE).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    inter800: document.fonts.check('800 10px Inter'),
    inter400: document.fonts.check('400 10px Inter'),
    plexMono: document.fonts.check('400 10px "IBM Plex Mono"'),
    loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
  }));
  const fontsOk = fonts.inter800 && fonts.inter400 && fonts.plexMono && fonts.loaded.length > 0;
  console.log(`fonts loaded: ${fonts.loaded.length ? fonts.loaded.join(', ') : 'NONE'}`);
  if (!fontsOk && !outDir) {
    console.error('✗ web fonts did not load (Inter / IBM Plex Mono); refusing to overwrite the committed cover. Use --out <dir> for a preview.');
    process.exit(3);
  }
  if (!fontsOk) console.warn('⚠ web fonts did not load — this preview shows the system fallback');

  await page.screenshot({ path: pngOut, type: 'png', fullPage: false, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  const meta = await sharp(pngOut).metadata();
  if (meta.width !== WIDTH || meta.height !== HEIGHT) {
    console.error(`✗ screenshot measures ${meta.width} x ${meta.height}, expected ${WIDTH} x ${HEIGHT}`);
    process.exit(4);
  }
  console.log(`png  ${pngOut}  ${meta.width} x ${meta.height}  ${statSync(pngOut).size.toLocaleString('en-US')} B`);

  if (!pngOnly) {
    await sharp(pngOut).webp({ quality: 80, effort: 6 }).toFile(webpOut);
    const wmeta = await sharp(webpOut).metadata();
    const pngBytes = statSync(pngOut).size;
    const webpBytes = statSync(webpOut).size;
    console.log(`webp ${webpOut}  ${wmeta.width} x ${wmeta.height}  ${webpBytes.toLocaleString('en-US')} B  (${((webpBytes / pngBytes) * 100).toFixed(1)}% of the PNG; sharp ${sharp.versions.sharp} / libwebp ${sharp.versions.webp})`);
  }
} finally {
  await browser.close();
}
