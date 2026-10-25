/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Guards `createLazyPlugin`'s own `@example` block.
 *
 * objectui#5949: that docblock taught `() => import('@object-ui/plugin-grid')`
 * as the `importFn`. The package exports its components BY NAME and has no
 * `default`, so the call handed `React.lazy` the module namespace object —
 * wrong at compile time (TS2345, `Property 'default' is missing`) and wrong at
 * runtime (renders nothing useful). It survived because a JSDoc `@example`
 * inside a `.tsx` source file is read by NO gate in this repo:
 * `check-doc-snippet-types.mjs` states its scan surface as "every `.mdx` and
 * `.md` page under `content/docs`, plus every `packages/<name>/README.md`" —
 * markdown documents only. The wrong call therefore shipped in the published
 * `.d.ts` that editors surface on hover, the highest-traffic place a reader
 * meets it.
 *
 * ⚠️ The honest limit of this file, stated because a reader of a green run
 * needs it. It does NOT compile the docblock's literal text. It cannot:
 * `@object-ui/plugin-grid` depends on `@object-ui/react`, so this package
 * cannot import it in either direction without a workspace cycle. Instead it
 * pins the two halves that together make the example true, and each half is
 * checked by the thing that can actually judge it:
 *
 *   1. THE SHAPE COMPILES — `typeLevelContract` below is compiled by
 *      `tsc -p tsconfig.test.json` (chained from this package's `type-check`
 *      script, which is what CI's `Type Check` job runs). It pins that
 *      unwrapping a named export satisfies `importFn` and that the bare
 *      namespace form is REJECTED. Nothing here runs under vitest.
 *   2. THE DOCBLOCK TEACHES THAT SHAPE — the runtime tests below read the
 *      source and assert the `@example` block uses the unwrap and never the
 *      bare form, so the compiled shape and the documented text cannot drift.
 *
 * ⛔ Do not "fix" a failure here by adding a default export to
 * `@object-ui/plugin-grid`. That is a contract change on a published package;
 * the documented surface is the thing under guard, not the package.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type React from 'react';
import { createLazyPlugin } from '../LazyPluginLoader';

const SOURCE_PATH = new URL('../LazyPluginLoader.tsx', import.meta.url);
/** Read, not imported: a path read is not a build edge, so this asserts across
 *  the package boundary without creating the cycle described above. */
const PLUGIN_GRID_INDEX = new URL('../../../plugin-grid/src/index.tsx', import.meta.url);

const source = readFileSync(SOURCE_PATH, 'utf8');

/** The `/** ... *\/` docblock immediately preceding `export function createLazyPlugin`.
 *  Anchored on that declaration specifically: `preloadPlugin`'s example lower in
 *  the same file passes a bare `() => import('@object-ui/plugin-grid')` and is
 *  CORRECT to — its parameter is `() => Promise<T>`, which expects no `default`. */
function createLazyPluginDocblock(): string {
  const decl = source.indexOf('export function createLazyPlugin');
  if (decl === -1) throw new Error('`export function createLazyPlugin` not found — re-anchor this test.');
  const open = source.lastIndexOf('/**', decl);
  const close = source.indexOf('*/', open);
  if (open === -1 || close === -1 || close > decl) throw new Error('docblock for `createLazyPlugin` not found.');
  return source.slice(open, close + 2);
}

/** The CODE inside the docblock's ```tsx fence: JSDoc ` * ` margins stripped and
 *  `//` lines dropped. The negative assertions below must judge what the example
 *  TELLS THE READER TO WRITE, not the prose that warns them off a spelling —
 *  running them over the raw block makes this file's own warnings trip it. */
function createLazyPluginExampleCode(): string {
  const block = createLazyPluginDocblock();
  const fence = block.match(/```tsx\n([\s\S]*?)```/);
  if (!fence) throw new Error('no ```tsx fence in `createLazyPlugin`\'s docblock — re-anchor this test.');
  return fence[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

describe('createLazyPlugin @example (objectui#5949)', () => {
  it('anchors on a docblock that really is the one carrying the example', () => {
    // Control probe: a zero-hit assertion below must mean "absent", not "mis-anchored".
    const block = createLazyPluginDocblock();
    expect(block).toContain('@example');
    expect(block).toContain('@object-ui/plugin-grid');
    expect(block).toContain('createLazyPlugin(');
    // ...and that the code-only view the negative assertions run over is real,
    // so a zero-hit there reads as "absent" rather than "mis-extracted".
    const code = createLazyPluginExampleCode();
    expect(code).toContain('createLazyPlugin(');
    expect(code).toContain("import('@object-ui/plugin-grid')");
    expect(code.split('\n').filter((l) => l.trimStart().startsWith('//'))).toHaveLength(0);
  });

  it('never passes a bare module namespace import as importFn', () => {
    const code = createLazyPluginExampleCode();
    // The exact defect: `import(...)` as the WHOLE argument, no named unwrap.
    expect(code).not.toMatch(/\(\s*\)\s*=>\s*import\('@object-ui\/plugin-[a-z-]+'\)/);
  });

  it('unwraps a named export, in the `async` spelling', () => {
    const code = createLazyPluginExampleCode();
    const unwraps = code.match(
      /async \(\) => \(\{ default: \(await import\('@object-ui\/plugin-grid'\)\)\.ObjectGrid \}\)/g,
    );
    expect(unwraps).toHaveLength(3);
    // ⚠️ Not the `.then` spelling: it infers `P` as `never` on one branch of the
    // `then` overload and does not compile (measured on objectui#5949).
    expect(code).not.toContain('.then(');
  });

  it('declares each example with a distinct name so the block is one coherent program', () => {
    const code = createLazyPluginExampleCode();
    const names = [...code.matchAll(/const (\w+) = createLazyPlugin\(/g)].map((m) => m[1]);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(names.length);
  });

  it('rests on `@object-ui/plugin-grid` having no default export', () => {
    // The premise the example encodes. If this ever flips, the docblock's
    // "has no default export" warning is stale and must be rewritten — not
    // silenced here.
    const gridIndex = readFileSync(PLUGIN_GRID_INDEX, 'utf8');
    expect(gridIndex).toContain('export { ObjectGrid, VirtualGrid, ImportWizard };'); // control probe
    expect(gridIndex).not.toMatch(/^export default /m);
    expect(gridIndex).not.toMatch(/\bexport\s*\{[^}]*\bas default\b/);
  });
});

/**
 * Compiled, never executed. `tsc -p tsconfig.test.json` is the assertion here;
 * vitest never calls this and must not.
 */
export function typeLevelContract(): void {
  /** `@object-ui/plugin-grid`'s real export shape: named exports, no `default`. */
  type PluginGridModule = {
    ObjectGrid: React.FC<{ objectName?: string }>;
    VirtualGrid: React.FC<{ rows?: number }>;
    ImportWizard: React.FC<{ open?: boolean }>;
  };
  const importPluginGrid = null as unknown as () => Promise<PluginGridModule>;

  // ✅ what the docblock now teaches.
  void createLazyPlugin(async () => ({ default: (await importPluginGrid()).ObjectGrid }));

  // ⛔ what it used to teach. `@ts-expect-error` is the guard: if this call ever
  // stops being an error, the compiler has begun accepting a namespace object
  // where a component belongs, and THIS LINE turns the build red.
  // @ts-expect-error TS2345 — `Property 'default' is missing in type 'PluginGridModule'`.
  void createLazyPlugin(importPluginGrid);
}
