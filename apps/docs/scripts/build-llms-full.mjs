#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Writes `public/llms-full.txt` -- every docs page's `getLLMText()`, joined by
 * one blank line, in `source.getPages()` order -- at BUILD time, as a static
 * file. Run by this app's `build` script, after the spec generators and before
 * `next build`:
 *
 *   node scripts/build-llms-full.mjs              # writes public/llms-full.txt
 *   node scripts/build-llms-full.mjs <out-file>   # writes elsewhere (measuring)
 *
 * ## Why a build-time file and not a route handler
 *
 * `/llms-full.txt` used to be `app/llms-full.txt/route.ts` with
 * `revalidate = false`. `next build` prerenders such a route, and Vercel stores
 * a prerendered route as an ISR page whose body is its fallback; the deploy API
 * refuses a fallback body over 20 MB (`FALLBACK_BODY_TOO_LARGE`, at the
 * `vercel deploy --prebuilt` upload, after a green build). The concatenation
 * measured 20,032,800 bytes over 418 pages at e611e2bda, so every production
 * docs deploy failed. A file under `public/` is not a prerender: Vercel's Next
 * builder copies it into the build output's `static/` tree and the CDN serves
 * it as a file, so that cap does not apply to it at any size. The URL, the body
 * and the `X-Robots-Tag: noindex` header (`next.config.mjs` `headers()`, which
 * Next applies before the filesystem, `public/` included) are unchanged.
 *
 * ## One producer
 *
 * The text is `getLLMText()` over `source.getPages()` from `lib/source.ts` --
 * the module the per-page `/llms.mdx/docs/**` route and `/llms.txt` read --
 * imported here as plain Node: fumadocs-mdx's Node loader compiles each page
 * with the same `source.config.ts`, and `llms-full/resolve-hooks.mjs` maps the
 * two tsconfig aliases. The output was byte-identical (sha256) to the retired
 * route's prerendered body on the same tree when this script replaced it; a
 * second copy of the page list or of `getLLMText` here would fork the two.
 *
 * ## `.source/` is regenerated first
 *
 * `.source/` is written by `pnpm install`'s postinstall, BEFORE the spec
 * generators run, so it does not list pages they add: on a fresh checkout
 * `content/docs/protocol-upgrade/` (gitignored) does not exist until
 * `gen:upgrade-guide` writes it. `next build` regenerates `.source/` when it
 * loads `next.config.mjs`; this script calls the same `postInstall()` first,
 * so both read the same page set.
 *
 * A failure anywhere here exits non-zero and fails the build: a deploy without
 * this file would 404 `/llms-full.txt` with no error anywhere.
 */

import { register } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(APP_ROOT, 'public', 'llms-full.txt');

if (!process.features.typescript) {
  console.error(
    `build-llms-full: this Node (${process.version}) cannot load lib/source.ts: it has no ` +
      'TypeScript type stripping. Use Node 22.18 or newer (the version CI and the deploy run).',
  );
  process.exit(1);
}

// `source.config.ts` resolves the content directory against the cwd, as it
// does under `next build`, whose cwd is this app.
const out = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;
process.chdir(APP_ROOT);

const { postInstall } = await import('fumadocs-mdx/next');
await postInstall();

register('./llms-full/resolve-hooks.mjs', import.meta.url);
const { register: registerMdx } = await import('fumadocs-mdx/node');
registerMdx();

const { source, getLLMText } = await import('@/lib/source');

const pages = source.getPages();
if (pages.length === 0) {
  console.error('build-llms-full: source.getPages() returned no pages; refusing to write an empty llms-full.txt.');
  process.exit(1);
}

const body = (await Promise.all(pages.map(getLLMText))).join('\n\n');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body);

const bytes = Buffer.byteLength(body);
console.log(
  `build-llms-full: ${pages.length} pages, ${bytes.toLocaleString('en-US')} bytes ` +
    `(${(bytes / 1e6).toFixed(2)} MB) -> ${relative(APP_ROOT, out) || out}`,
);
