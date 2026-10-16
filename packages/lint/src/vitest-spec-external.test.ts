// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Positive control for `test.server.deps.external` in ../vitest.config.ts.
//
// That entry hands the linked `@objectstack/spec` dist to Node instead of
// vite's transform. Its pattern is matched against the module's REALPATH, and
// a pattern that matches nothing is silent: the suite stays green and only
// gets slower. So this file asks the one question that tells the two apart —
// is the spec module these sources import the SAME instance Node's own loader
// holds?
//
// - Externalised: vitest's runner loads the dist with a native `import()`, so
//   Node's loader holds that module, and a native load of the same file
//   returns that very instance — its exports are identical objects.
// - Inlined (the pattern stopped matching): vite evaluates its own copy of the
//   dist, and the native load builds a separate one — every export is a
//   different object, and the identity assertions below go red.
//
// The native load is `require()` of the ESM file (Node 22's require(esm),
// which shares the ESM loader's module map) through `createRequire`, so vite
// cannot rewrite it; vitest's evaluator gives a `new Function` `import()` no
// dynamic-import callback. The file is the one the package's `exports` map
// names for an ESM import, taken from the linked package root.
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as specRoot from '@objectstack/spec';
import * as specData from '@objectstack/spec/data';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// The package's own node_modules link — the same one these sources resolve.
const SPEC_ROOT = realpathSync(resolve(HERE, '../node_modules/@objectstack/spec'));

const nativeRequire = createRequire(import.meta.url);

function nativeEsmEntry(subpath: '.' | './data'): Record<string, unknown> {
  const manifest = JSON.parse(readFileSync(join(SPEC_ROOT, 'package.json'), 'utf8'));
  const target: string = manifest.exports[subpath].import.default;
  return nativeRequire(join(SPEC_ROOT, target)) as Record<string, unknown>;
}

describe('@objectstack/spec is loaded by Node, not inlined by vite', () => {
  it('the root entry is the native module instance', () => {
    const native = nativeEsmEntry('.');
    expect(typeof specRoot.defineStack).toBe('function');
    expect(specRoot.defineStack).toBe(native.defineStack);
  });

  it('a subpath entry is the native module instance', () => {
    const native = nativeEsmEntry('./data');
    expect(specData.ObjectSchema).toBeDefined();
    expect(specData.ObjectSchema).toBe(native.ObjectSchema);
  });
});
