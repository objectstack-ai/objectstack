/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7837 — pins on the preamble the `Export to React` command writes
 * into every file a user gets.
 *
 * WHY A PIN AT ALL. The preamble lives inside a TEMPLATE LITERAL, so nothing
 * in this package's toolchain reads it: `tsc --noEmit` sees a string, `tsup`
 * copies it through, and the doc gates' surfaces are `content/docs`, the
 * per-app docs trees, `packages/NAME/README.md` and the root `README.md` —
 * none of which is this file. For as long as the preamble imported
 * `registerDefaultRenderers` from `@object-ui/components` and called it, this
 * package's own type-check was green and every generated file failed to
 * compile with `TS2305` on a symbol the user never typed. There was no binding
 * between the verifier and the thing verified; these assertions are it.
 *
 * WHY SOURCE TEXT AND NOT A COMPILE. Compiling the emitted code under test
 * would mean exporting `generateReactComponent()`, and objectui#7837 is
 * explicitly not allowed to move this package's export surface. So these read
 * the template out of the source instead. That is weaker than compiling the
 * output — it cannot catch a NEW phantom, only the return of this one and the
 * loss of its replacement — and the stronger instrument is filed separately.
 *
 * WHY THE SIDE-EFFECT IMPORT IS THE CORRECT SPELLING (measured, not recalled).
 * `@object-ui/components` declares `sideEffects: true`, its barrel runs
 * `import './renderers'` under the comment `Register all ObjectUI renderers
 * (side-effects)`, and its built `dist/index.js` carries 114 module-scope
 * `register(` call sites. Its built `dist/index.d.ts` exports exactly one
 * `register*` name — `registerPlaceholders`. There is no registration function
 * to call. Same spelling the root README landed for objectui#7417.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EXTENSION_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../extension.ts'),
  'utf8'
);

/**
 * The body of the template literal `generateReactComponent()` returns — i.e.
 * the text of the file the user receives, with the schema still uninterpolated.
 *
 * Every failure mode throws with "this pin needs rewriting, not deleting": if
 * the generator is refactored, the pin has to be pointed at the new shape, and
 * a silently-skipped assertion is exactly the failure this file exists to stop.
 */
function generatedFileTemplate(): string {
  const fn = EXTENSION_SRC.indexOf('function generateReactComponent');
  if (fn < 0) {
    throw new Error(
      'generateReactComponent() is gone from extension.ts — this pin needs rewriting, not deleting.'
    );
  }
  const open = EXTENSION_SRC.indexOf('return `', fn);
  if (open < 0) {
    throw new Error(
      'generateReactComponent() no longer returns a template literal — this pin needs rewriting, not deleting.'
    );
  }
  const start = open + 'return `'.length;
  const close = EXTENSION_SRC.indexOf('`;', start);
  if (close < 0) {
    throw new Error(
      'unterminated template literal in generateReactComponent() — this pin needs rewriting, not deleting.'
    );
  }
  return EXTENSION_SRC.slice(start, close);
}

describe('Export to React — the generated file preamble (objectui#7837)', () => {
  it('names no `registerDefaultRenderers`, which @object-ui/components does not export', () => {
    expect(generatedFileTemplate()).not.toContain('registerDefaultRenderers');
    // Belt and braces: the identifier is absent from the whole module, so a
    // second copy cannot reappear in a helper the template interpolates.
    expect(EXTENSION_SRC).not.toContain('registerDefaultRenderers');
  });

  it('imports @object-ui/components for its side effect, with no named binding', () => {
    const template = generatedFileTemplate();
    expect(template).toContain("import '@object-ui/components';");
    // A named import from that package is how the defect was spelled. Assert
    // the SHAPE is gone, not just the one identifier, so the next phantom off
    // that specifier fails here too.
    expect(template).not.toMatch(/import\s*\{[^}]*\}\s*from\s*'@object-ui\/components'/);
  });

  it('still imports SchemaRenderer from @object-ui/react — the renderer it calls', () => {
    const template = generatedFileTemplate();
    // objectui#11515: the same import also names the prop type the schema
    // constant is annotated with, type-only, so it adds no runtime binding.
    expect(template).toContain("import { SchemaRenderer, type SchemaRendererProps } from '@object-ui/react';");
    expect(template).toContain("const schema: SchemaRendererProps['schema'] = ");
    expect(template).toContain('<SchemaRenderer schema={schema} />');
  });
});
