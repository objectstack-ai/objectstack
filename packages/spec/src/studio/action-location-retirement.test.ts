// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

// ─── [#4737] `ActionLocation` has ONE owner per name (./studio renamed) ──────
//
// Dual-source ledger #4535, cluster C17. Before this change `ActionLocationSchema`
// was exported by TWO entry points for TWO different declarations:
//
//   ./studio — 3-value Studio IDE surface enum (`toolbar`, `contextMenu`,
//     `commandPalette`), consumed only by `ActionContributionSchema.location`
//     inside a Studio plugin manifest;
//   ./ui     — 7-value platform-canonical vocabulary for where an action
//     renders in a RUNNING APP's UI (`list_toolbar`, …, `global_nav`), whose
//     docblock declares it "single source of truth for the whole platform".
//
// Same name, disjoint vocabularies: which type a consumer got depended on
// nothing but the import path — the #4411 trap. Resolution (maintainer-ruled,
// #4737, ADR-0112 D9a): the STUDIO side is renamed
// `ActionContributionLocationSchema` (+ a new `ActionContributionLocation`
// type alias — the old const had no type export at all), with a RENAMED_DEFS
// carry (`studio/ActionLocation` → `studio/ActionContributionLocation`,
// 0 authorable keys — enum def). The ui side is UNTOUCHED: it is the only
// side with cross-repo consumers (objectui pins `ACTION_LOCATIONS` by
// reference in spec-derived-unions.test.ts and re-exports the type family),
// so renaming it would replay the objectui#3235 downstream breakage.
//
// #4642 established that a compile-time conditional-type pin in this package
// was a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR (re-exporting the ui enum
// from ./studio under the bare name — green to the dual-source gate, a lie to
// authors — and resurrecting the old 3-value const each turn it red).
describe('[#4737] studio ActionLocation dual-source retirement', () => {
  it('resolves the export surface: one owner per name, across every public entry', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, relative } = await import('node:path');
    const { dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { readFileSync } = await import('node:fs');

    const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    // Every public entry point, read from package.json's exports map so a
    // future entry cannot silently escape the uniqueness pins below.
    const pkg = JSON.parse(readFileSync(resolve(specDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const entries: Record<string, string> = {};
    for (const sub of Object.keys(pkg.exports)) {
      if (sub === '.') entries[sub] = resolve(specDir, 'src/index.ts');
      else if (/^\.\/[a-z-]+$/.test(sub)) entries[sub] = resolve(specDir, `src/${sub.slice(2)}/index.ts`);
      // './openapi.json' / './package.json' are not TypeScript entry points.
    }
    // Anti-vacuity: the enumeration must have found the real surface.
    for (const needed of ['./studio', './ui']) {
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
    const unalias = (s: import('typescript').Symbol) =>
      s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

    const exportsOf = (sub: string) => {
      const sf = program.getSourceFile(entries[sub]);
      const moduleSym = sf && checker.getSymbolAtLocation(sf);
      // Without this guard a resolution failure would make every assertion
      // below pass vacuously — the exact way a gate goes dormant (#4642).
      expect(moduleSym, `${sub} module symbol must resolve`).toBeTruthy();
      return checker.getExportsOfModule(moduleSym!);
    };

    const originOf = (sym: import('typescript').Symbol, label: string) => {
      const decl = unalias(sym).declarations?.[0];
      expect(decl, `${label} must have a declaration`).toBeTruthy();
      const declFile = decl!.getSourceFile();
      return `${relative(specDir, declFile.fileName)}:${
        declFile.getLineAndCharacterOfPosition(decl!.getStart()).line + 1
      }`;
    };

    /** Every entry that exports `name`, with each occurrence's declaration origin. */
    const holdersOf = (name: string) => {
      const out: Array<{ sub: string; origin: string }> = [];
      for (const sub of Object.keys(entries)) {
        for (const sym of exportsOf(sub).filter((e) => e.getName() === name)) {
          out.push({ sub, origin: originOf(sym, `${sub} ${name}`) });
        }
      }
      return out;
    };

    // 1. The renamed-away side: `./studio` still has a non-trivial surface —
    //    so the `not.toContain` cannot pass by resolving nothing — and no
    //    longer names the old export, while surviving neighbours stand.
    const studioNames = exportsOf('./studio').map((e) => e.getName());
    expect(studioNames.length, './studio must export a non-trivial surface').toBeGreaterThan(40);
    for (const retired of ['ActionLocationSchema', 'ActionLocation']) {
      expect(studioNames, `./studio must not export ${retired}`).not.toContain(retired);
    }
    expect(studioNames).toContain('ActionContributionSchema');
    expect(studioNames).toContain('StudioPluginManifestSchema');

    // 2. The renamed side: `ActionContributionLocation(Schema)` originates in
    //    studio/plugin.zod.ts and is exported by ./studio alone (plus nothing
    //    else — the rename must not fan out).
    for (const name of ['ActionContributionLocationSchema', 'ActionContributionLocation']) {
      const holders = holdersOf(name);
      expect(holders.length, `${name} must be exported (by ./studio)`).toBeGreaterThan(0);
      for (const h of holders) {
        expect(h.sub, `${name} must only be exported by ./studio`).toBe('./studio');
        expect(h.origin).toMatch(/^src\/studio\/plugin\.zod\.ts:\d+$/);
      }
    }

    // 3. The bare `ActionLocation(Schema)` now has exactly ONE owner: ./ui,
    //    declared in ui/action.zod.ts. Not just "same declaration everywhere"
    //    — NO other entry may export the bare name at all. A re-export from
    //    ./studio would share the declaration (green to the dual-source gate)
    //    while telling Studio plugin authors that `list_toolbar` & co. are
    //    valid manifest contribution locations — the C14/C15 lesson: a
    //    re-export can lie about the domain even when the symbol is honest.
    for (const name of ['ActionLocationSchema', 'ActionLocation']) {
      const holders = holdersOf(name);
      expect(holders.map((h) => h.sub), `${name} must be owned by ./ui alone`).toEqual(['./ui']);
      expect(holders[0].origin).toMatch(/^src\/ui\/action\.zod\.ts:\d+$/);
    }

    // 4. The canonical list constant travels with it: `ACTION_LOCATIONS` (the
    //    array objectui pins by reference) stays ./ui-owned and distinct from
    //    the studio declaration file.
    const listHolders = holdersOf('ACTION_LOCATIONS');
    expect(listHolders.map((h) => h.sub), 'ACTION_LOCATIONS must be owned by ./ui alone').toEqual(['./ui']);
    expect(listHolders[0].origin).toMatch(/^src\/ui\/action\.zod\.ts:\d+$/);
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const studio = await import('./index');
    const ui = await import('../ui/index');

    // Renamed-away side — the old const is gone from ./studio at runtime too.
    expect('ActionLocationSchema' in studio, 'studio must not export ActionLocationSchema').toBe(false);
    // Anti-vacuity: the namespace we just probed is real and non-trivial.
    expect('StudioPluginManifestSchema' in studio).toBe(true);

    // Renamed side — the Studio IDE vocabulary, byte-for-byte unchanged.
    expect('ActionContributionLocationSchema' in studio).toBe(true);
    for (const loc of ['toolbar', 'contextMenu', 'commandPalette']) {
      expect(() => studio.ActionContributionLocationSchema.parse(loc)).not.toThrow();
    }
    // The two vocabularies were disjoint precisely here — the app-UI values
    // must NOT leak into the Studio contribution enum:
    expect(() => studio.ActionContributionLocationSchema.parse('list_toolbar')).toThrow();
    expect(() => studio.ActionContributionLocationSchema.parse('global_nav')).toThrow();

    // ui side — untouched, and still the 7-value app-UI vocabulary.
    expect('ActionLocationSchema' in ui).toBe(true);
    expect('ACTION_LOCATIONS' in ui).toBe(true);
    for (const loc of ['list_toolbar', 'record_header', 'global_nav']) {
      expect(() => ui.ActionLocationSchema.parse(loc)).not.toThrow();
    }
    expect(() => ui.ActionLocationSchema.parse('toolbar')).toThrow();
    expect(() => ui.ActionLocationSchema.parse('commandPalette')).toThrow();
  });

  it('still parses an authored plugin manifest through the renamed enum — the live path', async () => {
    const { StudioPluginManifestSchema } = await import('./plugin.zod');
    const manifestWith = (location: string) => ({
      id: 'objectstack.object-designer',
      name: 'Object Designer',
      contributes: {
        actions: [{ id: 'deploy', label: 'Deploy', location }],
      },
    });
    const parsed = StudioPluginManifestSchema.parse(manifestWith('toolbar'));
    expect(parsed.contributes.actions[0].location).toBe('toolbar');
    // The authored VALUE domain did not move an inch with the TS rename; the
    // SAME document differing only in this one value stays illegal (so this
    // negative cannot pass for an unrelated reason):
    expect(() => StudioPluginManifestSchema.parse(manifestWith('list_toolbar'))).toThrow();
  });
});
