/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Builds `dist/index.css` from `src/index.css`.
 *
 * Why a standalone script (instead of `import './index.css'` in `src/index.ts`):
 *   In a pnpm monorepo dev server, that import would inject a SECOND
 *   Tailwind stylesheet (its `@source` only scans this package's src),
 *   which would override responsive utilities (`md:hidden`, `!top-14`, …)
 *   declared in sibling packages. See the comment in `src/index.ts`.
 *
 * This script runs only during `pnpm build` so consumers can still
 * `@import '@object-ui/components/style.css'` from their own CSS entry.
 *
 * The build pipeline:
 *   1. `vite build` extracts `import './sidebar-fixes.css'` from `src/index.ts`
 *      and writes it to `dist/index.css` (~2 kB of plain CSS overrides).
 *   2. This script runs AFTER vite, reads the Vite-emitted file, then
 *      prepends the full Tailwind compilation of `src/index.css`. Order
 *      matters — Tailwind utilities first, sidebar overrides last so they
 *      win on equal specificity.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const input = resolve(root, 'src/index.css');
const output = resolve(root, 'dist/index.css');

const css = await readFile(input, 'utf8');
const result = await postcss([tailwindPostcss()]).process(css, {
  from: input,
  to: output,
});

let viteEmittedOverrides = '';
try {
  await access(output);
  viteEmittedOverrides = await readFile(output, 'utf8');
} catch {
  // Vite did not emit dist/index.css (e.g. fresh build). That's fine — the
  // sidebar-fixes.css source will be missing from the published bundle, but
  // the same overrides also load at runtime from the JS-side
  // `import './sidebar-fixes.css'`. This branch is mainly defensive.
}

const merged = viteEmittedOverrides
  ? `${result.css}\n\n/* === sidebar-fixes.css (extracted by Vite) === */\n${viteEmittedOverrides}`
  : result.css;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, merged, 'utf8');
if (result.map) await writeFile(`${output}.map`, result.map.toString(), 'utf8');

const sizeKb = (Buffer.byteLength(merged, 'utf8') / 1024).toFixed(2);
console.log(`✓ built dist/index.css (${sizeKb} kB)`);

