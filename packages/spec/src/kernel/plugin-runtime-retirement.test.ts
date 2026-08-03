// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

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
// compile-time conditional-type assertion in this package is a no-op (the
// package tsconfig excludes `**/*.test.ts`, and vitest never enables
// `typecheck`), so a `Assert< Equal< … > >` here would be decoration. The
// load-bearing pin is the TypeScript compiler-API program below, which resolves
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

  it('resolves the export surface: the retired names have ZERO holders across every public entry', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { readFileSync } = await import('node:fs');

    const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    // Every public entry point, read from package.json's exports map so a
    // future entry cannot silently escape the absence assertions below.
    const pkg = JSON.parse(readFileSync(resolve(specDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const entries: Record<string, string> = {};
    for (const sub of Object.keys(pkg.exports)) {
      if (sub === '.') entries[sub] = resolve(specDir, 'src/index.ts');
      else if (/^\.\/[a-z-]+$/.test(sub)) entries[sub] = resolve(specDir, `src/${sub.slice(2)}/index.ts`);
      // './openapi.json' / './package.json' are not TypeScript entry points.
    }
    // Anti-vacuity (1): the enumeration found the real surface — including the
    // entry that used to own every retired name, and the root barrel that
    // re-exported it.
    for (const needed of ['.', './kernel']) {
      expect(Object.keys(entries), `exports map must include ${needed}`).toContain(needed);
    }
    expect(Object.keys(entries).length).toBeGreaterThan(10);

    const program = ts.createProgram(Object.values(entries), {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();

    const exportsOf = (sub: string) => {
      const sf = program.getSourceFile(entries[sub]);
      const moduleSym = sf && checker.getSymbolAtLocation(sf);
      // Anti-vacuity (2): without this guard a resolution failure would make
      // every absence assertion below pass for free — exactly how a gate goes
      // dormant (#4642).
      expect(moduleSym, `${sub} module symbol must resolve`).toBeTruthy();
      return checker.getExportsOfModule(moduleSym!);
    };

    /** Every entry that exports `name` — for a removal this must be []. */
    const holdersOf = (name: string): string[] => {
      const out: string[] = [];
      for (const sub of Object.keys(entries)) {
        if (exportsOf(sub).some((e) => e.getName() === name)) out.push(sub);
      }
      return out;
    };

    // Anti-vacuity (3): `holdersOf` actually finds holders when a name IS
    // exported — proven on a surviving kernel neighbour, so `[]` below means
    // "absent", not "the probe is broken".
    expect(holdersOf('PluginSchema')).toContain('./kernel');
    const kernelNames = exportsOf('./kernel').map((e) => e.getName());
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
    await expect(import('./plugin-runtime.zod')).rejects.toThrow();
  });
});
