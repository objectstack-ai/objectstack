// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The narrow scorer entry's SOURCE import graph (#30915): everything
 * `src/score/narrow.ts` (`@objectstack/scenarios/score`) reaches through
 * relative imports, type-only ones included, names no `@objectstack/objectql`
 * or `@objectstack/plugin-sharing` specifier. Read from the checkout, so it
 * holds without a build; test/build/built-consumer.test.ts reads the same
 * fact off the built entry at runtime.
 *
 * The control leg walks the full entry (`src/score/index.ts`, `./score/full`)
 * with the same walker and must find both packages: a walker that sees no
 * import at all would pass the narrow leg too.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const FORBIDDEN = ['@objectstack/objectql', '@objectstack/plugin-sharing'];

// `import … from 'x'`, `export … from 'x'`, `import 'x'`, `import('x')`.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

/** Bare specifiers reached from `entry`, each with the first file that imports it. */
function bareImports(entry: string): Map<string, string> {
  const bare = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    for (const [, spec] of text.matchAll(SPECIFIER)) {
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
      else if (!bare.has(spec)) bare.set(spec, file.slice(SRC.length + 1));
    }
  }
  return bare;
}

const reaches = (bare: Map<string, string>, pkg: string) =>
  [...bare.keys()].filter((s) => s === pkg || s.startsWith(`${pkg}/`));

describe('the ./score entry import graph', () => {
  it('reaches neither objectql nor plugin-sharing', () => {
    const bare = bareImports('score/narrow.ts');
    for (const pkg of FORBIDDEN) expect(reaches(bare, pkg), `${pkg} via ${bare.get(pkg)}`).toEqual([]);
    // What it does read: the core stack-collection rule and the spec.
    expect([...bare.keys()].filter((s) => s.startsWith('@objectstack/')).sort()).toEqual([
      '@objectstack/core',
      '@objectstack/spec/api',
      '@objectstack/spec/data',
      '@objectstack/spec/meta-spelling',
    ]);
  });

  it('control: the same walker finds both packages from ./score/full', () => {
    const bare = bareImports('score/index.ts');
    for (const pkg of FORBIDDEN) expect(reaches(bare, pkg)).toEqual([pkg]);
  });
});
