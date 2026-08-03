// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4700 — the ROOT entry of `@objectstack/types` must stay free of `node:`
 * builtins.
 *
 * `@objectstack/types` is a dependency of `@objectstack/hono` ("edge-compatible
 * REST API server for Cloudflare Workers, Deno, Bun, and Node") and of the
 * plugin/service layer a `LiteKernel` boots on Workers. Moving the host-app
 * resolver (`node:module` / `node:url`) into this package is only safe because
 * it sits behind the `./node` subpath export, which those consumers never
 * import.
 *
 * That safety is an invariant, and an invariant nobody checks is a comment. The
 * failure it guards against is silent and delayed: someone adds a `readFileSync`
 * to a root-reachable file, every test here passes, every framework consumer
 * passes, and the break surfaces as a Workers bundle failure in a downstream
 * repo — the "declared ≠ enforced" shape of Prime Directive #10, one layer under
 * the packaging.
 *
 * So this walks the real import graph from `src/index.ts` and fails on the first
 * `node:` specifier it can reach.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * This package is CJS-typed (no `"type": "module"` — it publishes `dist/index.js`
 * as CommonJS), so `module: NodeNext` forbids `import.meta` here. Walk up from
 * the CWD to the package root instead, which works wherever vitest is invoked
 * from.
 */
function findPackageRoot(): string {
  let dir = process.cwd();
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
      if (name === '@objectstack/types') return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('could not locate the @objectstack/types package root');
    dir = parent;
  }
}

const PKG = findPackageRoot();
const SRC = join(PKG, 'src');

/** `import ... from 'x'` / `export ... from 'x'` / `await import('x')`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(SPECIFIER)) out.push(m[1]!);
  return out;
}

/** Resolve a relative TS import (`./x.js` → `src/x.ts`). */
function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = join(dirname(fromFile), spec);
  for (const cand of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand;
  }
  return undefined;
}

/** Every source file reachable from an entry, following relative imports. */
function reachableFrom(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const specs = specifiersOf(file);
    seen.set(file, specs);
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue;
      const next = resolveRelative(file, spec);
      if (next) queue.push(next);
    }
  }
  return seen;
}

describe('@objectstack/types — node-only code stays behind the ./node subpath (#4700)', () => {
  it('nothing reachable from the root entry imports a `node:` builtin', () => {
    const graph = reachableFrom(join(SRC, 'index.ts'));
    const offenders: string[] = [];
    for (const [file, specs] of graph) {
      for (const spec of specs) {
        if (spec.startsWith('node:')) offenders.push(`${file.slice(PKG.length + 1)} -> ${spec}`);
      }
    }
    expect(
      offenders,
      'The root export must stay edge/browser-safe — @objectstack/hono bundles it for ' +
        'Cloudflare Workers, Deno and Bun, where a `node:` builtin breaks the bundle even ' +
        'if it is never called. Put node-only code in src/node.ts (exported as ' +
        '"@objectstack/types/node") instead.',
    ).toEqual([]);
  });

  it('the root entry does not reach src/node.ts at all', () => {
    const graph = reachableFrom(join(SRC, 'index.ts'));
    expect(
      [...graph.keys()].map((f) => f.slice(PKG.length + 1)),
      're-exporting the node slice from the root would defeat the subpath split',
    ).not.toContain('src/node.ts');
  });

  it('src/node.ts really is the node-only slice — otherwise this suite proves nothing', () => {
    // Guards against the vacuous pass: if the resolver ever stopped using node
    // builtins, the two cases above would go green for the wrong reason and the
    // subpath would look justified when it no longer was.
    const specs = specifiersOf(join(SRC, 'node.ts'));
    expect(specs.filter((s) => s.startsWith('node:')).sort()).toEqual([
      'node:module',
      'node:path',
      'node:url',
    ]);
  });

  it('package.json publishes the ./node subpath', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(Object.keys(pkg.exports)).toContain('./node');
    expect(pkg.exports['./node']).toEqual({
      types: './dist/node.d.ts',
      import: './dist/node.mjs',
      require: './dist/node.js',
    });
  });
});
