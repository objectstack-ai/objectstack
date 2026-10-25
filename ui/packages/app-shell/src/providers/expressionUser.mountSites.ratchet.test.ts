/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6515 ratchet — no mount site derives `current_user` by hand.
 *
 * ## Why a ratchet and not just the render test
 *
 * `expressionUser.mountParity.test.tsx` asserts the SHAPE a mount site
 * publishes, which is the assertion that matters — but it can only assert it
 * for the sites it renders. This card exists because a site that NEVER called
 * the normaliser was invisible to every pin in the repo: objectui#6110 exported
 * `buildExpressionUser` and wrote down that a second mount site re-deriving the
 * shape by hand "would reintroduce exactly the asymmetry #6010's parity pin
 * exists to refuse", and then `RecordFormPage` did precisely that, undetected,
 * across objectui#5424, #6010 and #6493.
 *
 * So this half enumerates the mount sites from SOURCE and refuses one that
 * builds its own descriptor. A third site added tomorrow is caught here even
 * though no render test knows it exists.
 *
 * ## What counts as a mount site
 *
 * The two ways this tier binds an identity into a predicate scope:
 *   - `<ExpressionProvider user={…}>` — the declarative one;
 *   - `createExpressionEvaluator({ user: … })` — the imperative one, used where
 *     a surface builds its field list ABOVE the provider it mounts and so
 *     cannot read the scope back through the hook.
 *
 * `providers/ExpressionProvider.tsx` is exempt: it is the SEAM, not a mount
 * site. It forwards the `user` prop its caller handed it, and the callers are
 * what this file checks.
 *
 * ## If this fails
 *
 * Do not add an accept pattern. Call `buildExpressionUser(user)` — the single
 * normaliser, importable from `providers/expressionUser.js` (a leaf module, so
 * a `lazy()`-loaded view can import it without a static edge back into
 * `AppContent`, which is what made the original site hand-roll it).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildExpressionUser } from './expressionUser';
// The back-compat re-export. objectui#6515 moved the function out of this
// module; `toBe` (identity, not shape) is what proves the name still resolves
// to the SAME function rather than to a second copy that could drift.
import { buildExpressionUser as viaAppContent } from '../console/AppContent';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/app-shell/src/providers  ->  repo root
const repoRoot = path.resolve(here, '../../../..');

/** Roots that hold this tier's expression mount sites. */
const SCAN_ROOTS = ['packages/app-shell/src', 'apps/console/src'];

/** The seam itself — it forwards its caller's prop; its callers are the sites. */
const EXEMPT = new Set([
  path.join('packages', 'app-shell', 'src', 'providers', 'ExpressionProvider.tsx'),
]);

function collectSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.wt-') || name === '__tests__') {
        continue;
      }
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      // Production sources only. Tests legitimately mount the provider with a
      // literal fixture user — that is the point of a fixture.
      if (/\.(test|spec|stories)\.tsx?$/.test(name)) continue;
      if (statSync(full).isFile()) out.push(full);
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root));
  return out;
}

/**
 * Blank out comment LINES before matching, so a doc-comment EXAMPLE
 * (`ExpressionProvider.tsx`'s own `@example` block mounts the provider with a
 * `currentUser` that does not exist) is not read as a mount site.
 *
 * Line-based on purpose. The obvious `/\*[\s\S]*?\*\//` strip is WRONG on real
 * sources and was measured wrong on `AppContent.tsx` here: a `/*` that occurs
 * inside a string or a `//` comment pairs with the next REAL `*\/`, and the
 * non-greedy span silently swallows the code between them — it ate the very
 * `createExpressionEvaluator` call this file exists to find, leaving a scan
 * that reported no violations because it had deleted the site. Dropping whole
 * comment lines cannot span code.
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map((line) => (/^\s*(?:\*|\/\/|\/\*)/.test(line) ? '' : line))
    .join('\n');
}

/** Balanced-brace read starting AT the opening brace. */
function readBalanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

interface Site {
  file: string;
  kind: 'ExpressionProvider' | 'createExpressionEvaluator';
  expression: string;
}

function collectSites(file: string, src: string): Site[] {
  const sites: Site[] = [];

  // Declarative: `<ExpressionProvider ... user={EXPR} ...>`
  const jsx = /<ExpressionProvider\b/g;
  let m: RegExpExecArray | null;
  while ((m = jsx.exec(src))) {
    const close = src.indexOf('>', m.index);
    const tag = src.slice(m.index, close === -1 ? src.length : close);
    const at = tag.indexOf('user={');
    if (at === -1) continue;
    sites.push({
      file,
      kind: 'ExpressionProvider',
      expression: readBalanced(tag, at + 'user='.length).trim(),
    });
  }

  // Imperative: `createExpressionEvaluator({ ... user: EXPR ... })`
  const call = /createExpressionEvaluator\s*\(\s*\{/g;
  while ((m = call.exec(src))) {
    const body = readBalanced(src, src.indexOf('{', m.index));
    const user = /(?:^|[,{\n])\s*user\s*:\s*([^\n]+?)\s*,?\s*$/m.exec(body);
    if (!user) continue;
    sites.push({ file, kind: 'createExpressionEvaluator', expression: user[1].trim() });
  }

  return sites;
}

/**
 * Does this `user` expression trace to the normaliser?
 *
 * Either it calls it outright, or it is a bare identifier whose declaration in
 * the same file calls it. Anything else — an object literal, a conditional, a
 * spread over the normaliser's output — is a hand-rolled descriptor.
 */
function tracesToNormaliser(expression: string, src: string): boolean {
  if (/\bbuildExpressionUser\s*\(/.test(expression)) return true;
  const ident = /^[A-Za-z_$][\w$]*$/.exec(expression);
  if (!ident) return false;
  const decl = new RegExp(
    `\\b(?:const|let|var)\\s+${ident[0]}\\b[^;]*?\\bbuildExpressionUser\\s*\\(`,
    's',
  );
  return decl.test(src);
}

describe('objectui#6515 — every expression mount site binds the shared `current_user` normaliser', () => {
  const files = collectSourceFiles();

  it('finds the mount sites it claims to govern', () => {
    // A scan that silently matches nothing is the failure mode this guards
    // against in itself — it would pass forever. The production sites are
    // `AppContent` (both kinds), `RecordFormPage` (both kinds), the console's
    // `InternalFormRoute`, and Home's `HomeLayout` (objectui#12700).
    const sites = files
      .filter((f) => !EXEMPT.has(path.relative(repoRoot, f)))
      .flatMap((f) => collectSites(f, stripComments(readFileSync(f, 'utf8'))));
    expect(sites.length).toBeGreaterThanOrEqual(5);
    expect(new Set(sites.map((s) => path.basename(s.file)))).toEqual(
      new Set(['AppContent.tsx', 'RecordFormPage.tsx', 'InternalFormRoute.tsx', 'HomeLayout.tsx']),
    );
  });

  it('refuses a mount site that derives the descriptor by hand', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      if (EXEMPT.has(rel)) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const site of collectSites(file, src)) {
        if (!tracesToNormaliser(site.expression, src)) {
          offenders.push(`${rel}  [${site.kind}]  user={${site.expression}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('objectui#6515 — the published name did not move', () => {
  it('still resolves through `console/AppContent`, to the SAME function', () => {
    // A source `export` keyword is not the test; identity is. A second copy
    // would satisfy every `export` grep and still drift.
    expect(viaAppContent).toBe(buildExpressionUser);
  });

  it('is still re-exported from the package entry', () => {
    // The entry's BUILT `.d.ts` is checked in the PR body against a real
    // rebuild; this is the cheap regression pin beside it.
    const entry = readFileSync(path.join(repoRoot, 'packages/app-shell/src/index.ts'), 'utf8');
    expect(entry).toMatch(/export\s*\{\s*buildExpressionUser\s*\}\s*from/);
  });
});
