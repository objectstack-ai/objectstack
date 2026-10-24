/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * BUILT-ARTIFACT PIN — the shipped `./zod` subpath is ONE module (objectui#8598).
 *
 * ## The defect this closes, and why only the BUILT face can answer it
 *
 * This package declares `"sideEffects": false`. `src/zod/index.zod.ts` fills the
 * node recursion point (objectui#8344) as the initializer of its
 * `AnyComponentSchema` const, and `tsc` emits that barrel as a module whose only
 * other content is re-exports. So a bundler resolving
 * `import { CardSchema } from '@object-ui/types/zod'` follows the re-export to
 * `dist/zod/layout.zod.js`, needs NOTHING from the barrel's own body, and the
 * flag lets it drop that body whole — fill included. Every child slot then
 * validates with the pre-#8344 `BaseSchemaCore` arm, silently.
 *
 * Every other test here reads `src` (the root alias map points
 * `@object-ui/types/zod` at `src/zod/index.zod.ts`), and a MODULE GRAPH always
 * evaluates the barrel. So no source test can fail on this defect: it is a
 * property of what `dist/` looks like, and nothing else.
 *
 * The `.dist.spec.tsx` suffix keeps this file out of `unit` (`*.test.ts`), `dom`
 * (`*.test.tsx`) and each package's `tsconfig.test.json` — see the header of
 * `packages/components/src/__tests__/page-header-action-ids.dist.spec.tsx`, the
 * first resident of this project, for why each of those matters.
 *
 * ⚠️ REQUIRES THE PACKAGE BUILT with `vite build` wired into its `build` script.
 * Case 1 below asserts that wiring by name, so "the manifest half never landed"
 * fails HERE, as a named assertion, instead of silently reducing this file to a
 * pin over `tsc`'s barrel.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
  exports: Record<string, { import: string }>;
  scripts: Record<string, string>;
};

/** The path a consumer resolves for `@object-ui/types/zod`, read from `exports`. */
const BUILT_ZOD_ENTRY = path.resolve(PACKAGE_DIR, MANIFEST.exports['./zod'].import);

/** A sibling `tsc` output, used as the live control for the reader below. */
const TSC_SIBLING = path.join(PACKAGE_DIR, 'dist', 'zod', 'layout.zod.js');

/** Every relative module specifier in an emitted ES module. */
function relativeSpecifiers(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/\bfrom\s*(['"])(\.[^'"]*)\1/g)].map((m) => m[2]);
}

/**
 * The nested off-spec node from objectui#7869. `IconSchema.size` is declared
 * `z.number()`, so `size: 'large'` one slot down is REFUSED under the filled arm
 * and ACCEPTED under the pre-#8344 one. Paired with a well-formed control, so a
 * schema that refuses EVERYTHING cannot pass for a fix.
 */
const NESTED_OFF_SPEC = { type: 'card', children: { type: 'icon', icon: 'check', size: 'large' } };
const NESTED_WELL_FORMED = { type: 'card', children: { type: 'icon', icon: 'check', size: 16 } };

/**
 * ⚠️ THE LINE THAT MAKES THIS A BUILT-ARTIFACT MEASUREMENT — relative on
 * purpose, because the specifier `@object-ui/types/zod` is redirected to `src`
 * by the root alias map. Held in a variable so Vite cannot resolve it at
 * transform time: with a literal specifier a missing `dist/` fails the file's
 * TRANSFORM and the named preconditions below never get to run.
 */
const BUILT_ZOD_SPECIFIER = '../../dist/zod/index.zod.js';
const BUILT = fs.existsSync(BUILT_ZOD_ENTRY)
  ? ((await import(BUILT_ZOD_SPECIFIER)) as { CardSchema: { safeParse(v: unknown): { success: boolean } } })
  : null;

describe('objectui#8598 — the shipped `./zod` face is one bundled module', () => {
  it('is wired: `build` runs `vite build` after `tsc` and before the completeness count', () => {
    // The order is the contract, not a preference. `tsc` writes all of `dist/`,
    // this build replaces exactly one of its outputs, and the completeness
    // count then verifies `tsc`'s expected set is still whole.
    expect(MANIFEST.scripts.build).toMatch(
      /^tsc\s*&&\s*vite build\s*&&\s*node \.\.\/\.\.\/scripts\/check-dist-completeness\.mjs$/,
    );
  });

  it('has been built — every assertion below is about a file that must exist', () => {
    expect(fs.existsSync(BUILT_ZOD_ENTRY), `${BUILT_ZOD_ENTRY} is missing — run \`pnpm --filter @object-ui/types build\``).toBe(true);
    expect(BUILT).not.toBeNull();
  });

  it('reads relative specifiers at all — the live control', () => {
    // Without this, "the barrel imports no sibling" is satisfied by a regex that
    // matches nothing, on any file, forever. `tsc`'s own `layout.zod.js` imports
    // its siblings by construction, so a working reader must find some there.
    expect(fs.existsSync(TSC_SIBLING)).toBe(true);
    expect(relativeSpecifiers(TSC_SIBLING).length).toBeGreaterThan(0);
  });

  it('imports NO sibling category module — that boundary is what the flag drops', () => {
    expect(
      relativeSpecifiers(BUILT_ZOD_ENTRY),
      'The published `./zod` entry still re-exports across a module boundary, so a bundler ' +
        'honouring `"sideEffects": false` can take the barrel body — and the #8344 fill — ' +
        'without taking the schema the consumer asked for.',
    ).toEqual([]);
  });

  /**
   * ⚠️ An ACCEPT-SET control over the WHOLE module — ⛔ not a measurement of the
   * single-schema entry, which is what this case used to claim in its name
   * (objectui#8712). A vitest import evaluates the entire barrel, as this
   * file's header already says, so the #8344 fill is reachable here whatever
   * the module boundary looks like. Measured against a `tsc` barrel of 30
   * separate modules — the ablated shape this file exists to refuse — the case
   * below PASSED, and the file went red through the structural case above,
   * which is the one that can see the defect. What this case holds is the other
   * half: the schema still refuses what it must and accepts what it must, so a
   * bundle that had started refusing everything cannot pass for a fix.
   */
  it('REFUSES a nested off-spec node, and accepts its well-formed twin', () => {
    expect(BUILT!.CardSchema.safeParse(NESTED_OFF_SPEC).success).toBe(false);
    // The control: the same slot, on-spec, still parses. A schema that refused
    // everything would satisfy the case above and be a much worse regression.
    expect(BUILT!.CardSchema.safeParse(NESTED_WELL_FORMED).success).toBe(true);
  });
});
