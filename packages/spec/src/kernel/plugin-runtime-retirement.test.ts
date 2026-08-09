// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
// ─── [#4834] the `plugin-runtime.zod` family is REMOVED ─────────────────────
//
// ADR-0049 enforce-or-remove, ruled REMOVE. `DynamicLoadRequestSchema`,
// `DynamicUnloadRequestSchema`, `DynamicPluginResultSchema`,
// `PluginSourceSchema` and `DynamicPluginOperationSchema` (+ every type alias)
// declared the "Dynamic Loading" capability — runtime load / unload / reload of
// plugins without a kernel restart. No runtime in objectstack / cloud /
// objectui ever received one of these requests or produced one of these
// results: the operations the vocabulary names do not exist. #3896 recorded the
// suspension as a deliberate design decision that lived only in a changeset
// paragraph; #4834 is that decision, answered.
//
// Why THIS pin, and not a type-level one: #4642 established that a
// compile-time conditional-type assertion in this package was a no-op (the
// package tsconfig excluded `**/*.test.ts`, and vitest never enables
// `typecheck`). #5286 closed that hole — `tsconfig.test.json` now compiles this
// file — so a type-level assertion here would no longer be dead text. It stays
// a runtime pin anyway, because a conditional over `keyof typeof import(...)`
// only enumerates VALUE exports (#4642) and this retirement covers types too.
// The load-bearing pin is the TypeScript compiler-API program below, which resolves
// the REAL export surface of EVERY public entry from `package.json`'s exports
// map and asserts each retired name has zero holders — by symbol identity, not
// by grepping text.
//
// Every `not`-shaped assertion has an anti-vacuity guard, because the failure
// mode of an absence pin is passing for the wrong reason (a path typo, an entry
// that stops resolving, an empty enumeration). Sabotage-verified in the PR:
//   1. re-declare `PluginSourceSchema` in `./kernel` → red;
//   2. re-export any of the five names from a DIFFERENT entry (`./studio`) →
//      red (a re-export can lie about the domain even when the symbol is
//      honest — the C14/C15 lesson);
//   3. point the entry enumeration at nothing → the anti-vacuity guards trip
//      instead of the suite passing silently.
describe('[#4834] plugin-runtime family removal — no entry exports any of the five names', () => {
  /** The five schema names + every type alias they published. */
  const RETIRED = [
    'DynamicLoadRequestSchema',
    'DynamicUnloadRequestSchema',
    'DynamicPluginResultSchema',
    'PluginSourceSchema',
    'DynamicPluginOperationSchema',
    'DynamicLoadRequest',
    'DynamicUnloadRequest',
    'DynamicPluginResult',
    'PluginSource',
    'DynamicPluginOperation',
    'DynamicLoadRequestInput',
    'DynamicUnloadRequestInput',
  ] as const;

  it('resolves the export surface: the retired names have ZERO holders across every public entry', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796. `holdersOf` is now the baseline's query, and
    // `export-origins.test.ts` pins that it discriminates.)
    for (const needed of ['.', './kernel']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // Anti-vacuity (3): `holdersOf` actually finds holders when a name IS
    // exported — proven on a surviving kernel neighbour, so `[]` below means
    // "absent", not "the probe is broken".
    expect(holdersOf('PluginSchema')).toContain('./kernel');
    const kernelNames = exportNamesOf('./kernel');
    expect(kernelNames.length, './kernel must still export a non-trivial surface').toBeGreaterThan(40);

    // The removal itself: NO public entry exports any of the twelve names —
    // not the old owner, and not some other entry that might "helpfully" adopt
    // them. Exact equality with `[]`, so a partial move cannot slip through.
    for (const name of RETIRED) {
      expect(holdersOf(name), `${name} must have zero holders`).toEqual([]);
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const kernel = await import('./index');
    const root = await import('../index');

    for (const [label, ns] of [['./kernel', kernel], ['.', root]] as const) {
      for (const name of RETIRED) {
        expect(name in ns, `${label} must not export ${name}`).toBe(false);
      }
    }
    // Anti-vacuity: the namespaces just probed are real and non-trivial.
    expect('PluginSchema' in kernel).toBe(true);
    expect(Object.keys(kernel).length).toBeGreaterThan(40);
  });

  it('the module itself is gone — nothing can import it by path either', async () => {
    // The names could be absent from the barrels while the module still sat on
    // disk, importable by deep path and still emitting json-schema defs. It
    // does not.
    //
    // The specifier is held in a variable on purpose. Now that tsc compiles
    // this file (#5286), a literal `import('./plugin-runtime.zod')` is a
    // TS2307 "cannot find module" — the compiler is agreeing with the test and
    // failing the build for it. An indirect specifier keeps the RUNTIME
    // assertion (the load must reject) exactly as it was, which is the pin.
    const retiredModule = './plugin-runtime.zod';
    await expect(import(retiredModule)).rejects.toThrow();
  });
});
