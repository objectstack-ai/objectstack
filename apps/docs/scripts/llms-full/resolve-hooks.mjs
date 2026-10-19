// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Node resolution hooks that let `scripts/build-llms-full.mjs` import
 * `lib/source.ts` as plain Node -- the module `next build` bundles -- instead
 * of a second copy of the page source.
 *
 * Each rule is the Node spelling of a resolution the Next build already does:
 *
 *   `fumadocs-mdx:collections/X` -> `.source/X.ts`    tsconfig.json `paths`
 *   `@/X`                         -> `X.ts`            tsconfig.json `paths`
 *   a bare import from a file outside this app that does not resolve there
 *   (`lucide-react`, `react/jsx-runtime` in a compiled `content/docs/**.mdx`)
 *                                 -> resolved from this app, which is what
 *                                    next.config.mjs's `turbopack.resolveAlias`
 *                                    does for the same reason: `content/` has
 *                                    no node_modules of its own.
 *
 * A `.ts` file reached through an alias is loaded as an ES module with its
 * types stripped (Node's own type stripping), so nothing here transpiles. A
 * specifier no rule claims goes to Node unchanged, and so does one a rule
 * cannot find on disk: a typo fails as loudly as anywhere else.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_MANIFEST_URL = pathToFileURL(join(APP_ROOT, 'package.json')).href;
const APP_DIR_URL = pathToFileURL(`${APP_ROOT}/`).href;

const ALIASES = [
  ['fumadocs-mdx:collections/', join(APP_ROOT, '.source')],
  ['@/', APP_ROOT],
];

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function aliasTarget(specifier) {
  for (const [prefix, dir] of ALIASES) {
    if (!specifier.startsWith(prefix)) continue;
    const base = join(dir, specifier.slice(prefix.length));
    for (const file of [base, `${base}.ts`, join(base, 'index.ts')]) {
      if (isFile(file)) return file;
    }
  }
  return null;
}

/** A package name, not a path, URL or `#` import. */
function isBare(specifier) {
  return !/^(?:[./#]|[a-z][a-z0-9+.-]*:)/i.test(specifier);
}

export async function resolve(specifier, context, nextResolve) {
  const file = aliasTarget(specifier);
  if (file) {
    const url = pathToFileURL(file).href;
    return file.endsWith('.ts')
      ? { url, format: 'module-typescript', shortCircuit: true }
      : { url, shortCircuit: true };
  }
  const parent = context.parentURL;
  if (isBare(specifier) && parent?.startsWith('file:') && !parent.startsWith(APP_DIR_URL)) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return nextResolve(specifier, { ...context, parentURL: APP_MANIFEST_URL });
    }
  }
  return nextResolve(specifier, context);
}
