// ADR-0080: generate the public-tier SDUI component manifest.
//
// The manifest records what each registration DECLARES (`config.inputs`, copied
// verbatim by `manifestFromConfigs`), never what a renderer reads. The framework
// diffs it against the spec schemas — a comparison of two declarations, so a
// prop both sides declare and nothing consumes reads there as agreement
// (objectstack#4413 shipped through exactly that; objectstack#4472 renamed the
// check to `check:react-declaration-parity` to stop it reading as proof of
// implementation).
//
// The registry is a browser app (plugin-map/charts pull browser-only deps), so
// the reliable way to enumerate it is in a real browser: load the built
// `manifest-dump.html` (which registers everything the console does and exposes
// `window.__MANIFEST = manifestFromConfigs(getPublicConfigs())`) and read it.
//
// Usage (build-console.sh wires this after building + serving the console dist):
//   BASE_URL=http://localhost:4173 OUT=packages/console/dist/sdui.manifest.json \
//     node scripts/dump-public-manifest.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5180';
const OUT = process.env.OUT ?? 'sdui.manifest.json';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/dev/manifest-dump.html`, { waitUntil: 'networkidle', timeout: 120_000 });
  // The page sets exactly one of these. Waiting only on __MANIFEST would turn
  // any generation failure into a silent 120s timeout instead of its message.
  const json = await page
    .waitForFunction(() => globalThis.__MANIFEST ?? globalThis.__MANIFEST_ERROR, null, { timeout: 120_000 })
    .then((h) => h.jsonValue());
  const failure = await page.evaluate(() => globalThis.__MANIFEST_ERROR);
  if (failure) throw new Error(`manifest generation failed in the browser:\n${failure}`);
  const manifest = JSON.parse(json);
  const n = Object.keys(manifest.components ?? {}).length;
  if (n === 0) throw new Error('empty manifest — registry not populated');
  writeFileSync(OUT, JSON.stringify(manifest, null, 2));
  console.log(`✓ wrote ${n} public blocks → ${OUT}`);
} finally {
  await browser.close();
}
