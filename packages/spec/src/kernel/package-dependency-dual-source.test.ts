// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

// ─── [#4741] `PackageDependency` has ONE owner per name (./kernel renamed) ───
//
// Dual-source ledger #4535, cluster C7 — the last cluster of the second batch.
// Before this change `PackageDependency` / `PackageDependencySchema` were each
// exported by TWO entry points for TWO different declarations:
//
//   ./cloud  — the DECLARATION form an author writes into a package manifest:
//     `{ packageId, versionRange, optional }`, embedded in
//     `PackageManifestSchema.dependencies[]` → `sys_package_version.manifest_json`;
//   ./kernel — the RESOLVER form the dependency resolver walks:
//     `{ name, versionConstraint, type, resolvedVersion }`, embedded in
//     `DependencyGraphNodeSchema.dependencies[]` and published through
//     `PluginSecurityProtocol`.
//
// The two key sets are ENTIRELY DISJOINT — zero shared properties. Neither
// schema is `.strict()`, so a document copied from one side to the other
// parsed "clean" with every foreign key silently stripped and every required
// key defaulted or missing: the #4411 trap in its most dangerous form (ADR-0104
// silent-strip class). Two concepts, not two spellings ⇒ ADR-0112 D9(a), route
// ruled by the maintainer on #4741: the KERNEL side is renamed
// `ResolvedPackageDependency(Schema)`, the cloud side keeps the bare name.
// `RENAMED_DEFS` carries `kernel/PackageDependency` →
// `kernel/ResolvedPackageDependency` (4 authorable keys, all four still
// present under the new def ⇒ zero tombstone, zero ADR-0087 conversion).
//
// #4642 established that a compile-time conditional-type pin in this package is
// a no-op (tsconfig excludes `**/*.test.ts`; vitest never enables `typecheck`),
// so the load-bearing pin is the compiler-API test below, with anti-vacuity
// guards. Sabotage-verified in the PR: S1 resurrecting the old kernel const,
// and S2 re-exporting the cloud declaration from ./kernel under the bare name
// (green to the dual-source gate — one declaration, many entries — but a lie
// to anyone reading `./kernel`, and independently rejected at BUILD time by
// RENAMED_DEFS invariant 3, "the source def is still emitted").
describe('[#4741] PackageDependency dual-source retirement (C7)', () => {
  it('resolves the export surface: one owner per name, across every public entry', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, relative, dirname } = await import('node:path');
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
    for (const needed of ['./cloud', './kernel']) {
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

    // 1. The renamed-away side: `./kernel` still has a non-trivial surface — so
    //    the `not.toContain` below cannot pass by resolving nothing — and no
    //    longer names the old export, while surviving neighbours stand. The two
    //    same-prefix neighbours are the trap this cluster was warned about:
    //    `PackageDependencyConflict` and `PackageDependencyResolutionResult`
    //    are DIFFERENT concepts that merely share a prefix, and must be intact.
    const kernelNames = exportsOf('./kernel').map((e) => e.getName());
    expect(kernelNames.length, './kernel must export a non-trivial surface').toBeGreaterThan(40);
    for (const retired of ['PackageDependencySchema', 'PackageDependency']) {
      expect(kernelNames, `./kernel must not export ${retired}`).not.toContain(retired);
    }
    for (const neighbour of [
      'PackageDependencyConflictSchema',
      'PackageDependencyConflict',
      'PackageDependencyResolutionResultSchema',
      'PackageDependencyResolutionResult',
      'DependencyGraphNodeSchema',
      'PluginSecurityProtocol',
    ]) {
      expect(kernelNames, `./kernel must still export ${neighbour}`).toContain(neighbour);
    }

    // 2. The renamed side: `ResolvedPackageDependency(Schema)` originates in
    //    kernel/plugin-security.zod.ts and is exported by ./kernel alone — the
    //    rename must not fan out into a second entry.
    for (const name of ['ResolvedPackageDependencySchema', 'ResolvedPackageDependency']) {
      const holders = holdersOf(name);
      expect(holders.length, `${name} must be exported (by ./kernel)`).toBeGreaterThan(0);
      for (const h of holders) {
        expect(h.sub, `${name} must only be exported by ./kernel`).toBe('./kernel');
        expect(h.origin).toMatch(/^src\/kernel\/plugin-security\.zod\.ts:\d+$/);
      }
    }

    // 3. The bare `PackageDependency(Schema)` now has exactly ONE owner:
    //    ./cloud, declared in cloud/package-version.zod.ts. Not merely "the
    //    same declaration everywhere" — NO other entry may export the bare name
    //    at all. A re-export from ./kernel would share the declaration (green
    //    to the dual-source gate, which judges by symbol identity) while
    //    telling resolver-side consumers that `versionConstraint` and
    //    `resolvedVersion` are fields of the manifest declaration form. That is
    //    the C14/C15/C17 lesson: a re-export can lie about the domain even when
    //    the symbol itself is honest. Exact equality, not a subset check.
    for (const name of ['PackageDependencySchema', 'PackageDependency']) {
      const holders = holdersOf(name);
      expect(holders.map((h) => h.sub), `${name} must be owned by ./cloud alone`).toEqual(['./cloud']);
      expect(holders[0].origin).toMatch(/^src\/cloud\/package-version\.zod\.ts:\d+$/);
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const kernel = await import('./index');
    const cloud = await import('../cloud/index');

    // Renamed-away side — the old const is gone from ./kernel at runtime too.
    expect('PackageDependencySchema' in kernel, 'kernel must not export PackageDependencySchema').toBe(false);
    // Anti-vacuity: the namespace we just probed is real and non-trivial, and
    // the same-prefix neighbours survived.
    expect('DependencyGraphNodeSchema' in kernel).toBe(true);
    expect('PackageDependencyConflictSchema' in kernel).toBe(true);
    expect('PackageDependencyResolutionResultSchema' in kernel).toBe(true);

    // Renamed side — the resolver vocabulary, byte-for-byte unchanged.
    expect('ResolvedPackageDependencySchema' in kernel).toBe(true);
    const resolved = kernel.ResolvedPackageDependencySchema.parse({
      name: 'com.objectstack.core',
      versionConstraint: '^1.0.0',
    });
    expect(resolved).toEqual({
      name: 'com.objectstack.core',
      versionConstraint: '^1.0.0',
      type: 'required', // the `.default('required')` still applies
    });

    // The namespace object published for SBOM / conflict reporting follows the
    // rename — it must not keep handing out the resolver schema under the name
    // this change gave back to ./cloud.
    expect('PackageDependency' in kernel.PluginSecurityProtocol).toBe(false);
    expect(kernel.PluginSecurityProtocol.ResolvedPackageDependency).toBe(
      kernel.ResolvedPackageDependencySchema,
    );

    // cloud side — untouched shape, and still the manifest declaration form.
    expect('PackageDependencySchema' in cloud).toBe(true);
    const declared = cloud.PackageDependencySchema.parse({
      packageId: 'com.objectstack.core',
      versionRange: '^1.0.0',
    });
    expect(declared).toEqual({
      packageId: 'com.objectstack.core',
      versionRange: '^1.0.0',
      optional: false, // the `.default(false)` still applies
    });
  });

  it('proves the two shapes were never interchangeable — the silent-strip trap', async () => {
    const { ResolvedPackageDependencySchema } = await import('./plugin-security.zod');
    const { PackageDependencySchema } = await import('../cloud/package-version.zod');

    // Zero shared keys: this is WHY the name had to move rather than converge.
    // If a future edit ever makes the key sets overlap, this assertion fails
    // and the "two concepts" premise of #4741 has to be re-argued.
    const keysOf = (s: { _zod: { def: { shape: Record<string, unknown> } } }) =>
      new Set(Object.keys(s._zod.def.shape));
    const kernelKeys = keysOf(ResolvedPackageDependencySchema as never);
    const cloudKeys = keysOf(PackageDependencySchema as never);
    expect([...kernelKeys].sort()).toEqual(['name', 'resolvedVersion', 'type', 'versionConstraint']);
    expect([...cloudKeys].sort()).toEqual(['optional', 'packageId', 'versionRange']);
    expect([...kernelKeys].filter((k) => cloudKeys.has(k)), 'key sets must stay disjoint').toEqual([]);

    // Neither side is `.strict()`, so cross-pasting a document does not throw —
    // it silently strips. That is exactly the failure mode the shared name hid,
    // and it is why the pin above forbids a "helpful" re-export alias.
    const manifestDoc = { packageId: 'com.objectstack.core', versionRange: '^1.0.0', optional: true };
    const strippedByResolver = ResolvedPackageDependencySchema.safeParse(manifestDoc);
    expect(strippedByResolver.success, 'resolver form rejects a manifest doc only on required keys').toBe(false);

    const resolverDoc = { name: 'com.objectstack.core', versionConstraint: '^1.0.0', type: 'peer' as const };
    const strippedByManifest = PackageDependencySchema.safeParse(resolverDoc);
    expect(strippedByManifest.success, 'manifest form rejects a resolver doc only on required keys').toBe(false);
  });
});
