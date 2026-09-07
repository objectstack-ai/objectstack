// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time syntax gate for `kind:'react'` pages (ADR-0081).
//
// A react page's `source` is REAL JavaScript/JSX executed at render by the
// runtime — so the constrained JSX parser (validate-jsx-pages) cannot check it.
// We instead transpile it with Sucrase (the same transpiler the runtime uses),
// transpile-ONLY — never executed — to surface syntax errors at `os build`
// instead of at render (ADR-0078: fail loudly at author time). It does NOT
// validate runtime behaviour (a transpiling page can still throw at render);
// the render-time error boundary owns that.

import { createRequire } from 'node:module';
import type { transform as sucraseTransform } from 'sucrase';
import { collectionEntries } from './collection-entries.js';

// Sucrase must NOT be imported at module top level: it is ~1.5 MB of CJS
// (~16 ms cold require), and @objectstack/lint sits on the kernel boot path —
// while this gate only runs when a `kind:'react'` page is actually validated
// (rare, trusted tier). Same boot-path contract as the TypeScript compiler in
// validate-react-page-props.ts: loaded lazily, on first use, staying a regular
// dependency in package.json. Guarded by lazy-deps.test.ts.
//
// `node:module` is a Node builtin, untouched by esbuild/tsup, so the static
// `createRequire` import survives bundling; the `createRequire(...)` call is
// deferred because `import.meta.url` is rewritten to an empty stub in the CJS
// build (same pattern as driver-sqlite-wasm's knex-wasm-dialect).
let cachedTransform: typeof sucraseTransform | null = null;
function loadSucraseTransform(): typeof sucraseTransform {
  if (cachedTransform) return cachedTransform;
  const anchor =
    typeof import.meta !== 'undefined' && import.meta.url
      ? import.meta.url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  try {
    cachedTransform = (createRequire(anchor)('sucrase') as { transform: typeof sucraseTransform }).transform;
  } catch (err) {
    throw new Error(
      `@objectstack/lint: validating a kind:'react' page requires the "sucrase" package, which could not be loaded ` +
        `(${err instanceof Error ? err.message : String(err)}). It is a declared dependency of @objectstack/lint — ` +
        `if this deployment prunes packages, keep "sucrase" in the image; it is only loaded when a react-source page is validated.`,
    );
  }
  return cachedTransform;
}

export type ReactPageSeverity = 'error' | 'warning';

export interface ReactPageFinding {
  severity: ReactPageSeverity;
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

export function validateReactPages(stack: AnyRec): ReactPageFinding[] {
  const findings: ReactPageFinding[] = [];
  for (const { rec: page, path: pagePath } of collectionEntries(stack.pages, 'pages')) {
    if (!page || page.kind !== 'react') continue;
    const name = String(page.name ?? pagePath);
    const source = page.source;
    if (typeof source !== 'string' || source.trim() === '') {
      findings.push({
        severity: 'error',
        rule: 'react-page-empty-source',
        where: `page "${name}"`,
        path: `${pagePath}.source`,
        message: "kind:'react' page has no `source`.",
        hint: 'Author the page as a real React component string in `source`.',
      });
      continue;
    }
    // Outside the try below on purpose: a missing transpiler must surface as
    // an error, not be swallowed as a syntax finding.
    const transform = loadSucraseTransform();
    try {
      // transpile-only (no eval) — catches syntax errors, unterminated JSX, etc.
      transform(source, { transforms: ['jsx', 'typescript'], production: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      findings.push({
        severity: 'error',
        rule: 'react-page-syntax',
        where: `page "${name}"`,
        path: `${pagePath}.source`,
        message: `kind:'react' source has a syntax error: ${message.split('\n')[0]}`,
        hint: 'The source is transpiled (never executed) at build to catch syntax errors early — fix the JS/JSX.',
      });
    }
  }
  return findings;
}
