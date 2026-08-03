// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { TenantPlanSchema } from './tenant.zod';

// ─── [#4739] `TenantPlan(Schema)` has ONE declaration — ./cloud ──────────────
//
// `./cloud` and `./system` both exported a `TenantPlan` + `TenantPlanSchema`,
// for two different declarations (the #4411 trap — which vocabulary a consumer
// got depended on the import path):
//
//   cloud/tenant.zod.ts → 5-value plan tier (free / starter / pro /
//     enterprise / custom) — the LIVE declaration: embedded in
//     `EnvironmentSchema.plan`, `TenantContextSchema.plan`,
//     `ProvisionTenantRequestSchema.plan`, and consumed by the cloud repo's
//     service-tenant through those schemas.
//   system/provisioning.zod.ts (removed) → 3-value subset (free / pro /
//     enterprise) embedded only in `TenantProvisioningRequest/Result` — a
//     provisioning protocol with zero implementations and zero importers in
//     any repo (objectstack / cloud / objectui), superseded by the cloud
//     `Provision*` family. Its companion contracts `IProvisioningService` and
//     `ITenantRouter` (./contracts) were equally declared-only and retired in
//     the same change.
//
// Maintainer ruling on #4739 (ledger #4535 C16): route B — delete the
// system-side provisioning family, cloud keeps the name. NOT a re-export
// convergence: the ruling is that the name LEAVES ./system entirely, so a
// future `export { TenantPlanSchema } from '../cloud/...'` in ./system is a
// forbidden route even though the dual-source gate (symbol identity) would
// not flag it — the uniqueness pin below catches exactly that (S2 sabotage).
//
// #4642 established that a compile-time conditional-type pin in this package
// is a no-op (tsconfig excludes `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR.
describe('[#4739] `TenantPlan(Schema)` resolves to the ./cloud declaration everywhere', () => {
  it('resolves the export surface: only ./cloud declares `TenantPlan(Schema)`; the provisioning family is gone', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, relative, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { readFileSync } = await import('node:fs');

    const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    // Every public entry point, read from package.json's exports map so a
    // future entry cannot silently escape the uniqueness pin below.
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
    expect(Object.keys(entries)).toContain('./cloud');
    expect(Object.keys(entries)).toContain('./system');
    expect(Object.keys(entries)).toContain('./contracts');
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

    // 1. The removed side: `./system` still has a non-trivial surface — so
    //    the `not.toContain` cannot pass by resolving nothing — and no longer
    //    names any of the provisioning family, while its surviving
    //    multi-tenant neighbours stand.
    const systemExports = exportsOf('./system');
    expect(systemExports.length, './system must export a non-trivial surface').toBeGreaterThan(100);
    const systemNames = systemExports.map((e) => e.getName());
    for (const gone of [
      'TenantPlan', 'TenantPlanSchema',
      'TenantRegion', 'TenantRegionSchema',
      'TenantProvisioningStatus', 'TenantProvisioningStatusEnum',
      'ProvisioningStep', 'ProvisioningStepSchema',
      'TenantProvisioningRequest', 'TenantProvisioningRequestSchema',
      'TenantProvisioningResult', 'TenantProvisioningResultSchema',
    ]) {
      expect(systemNames, `./system must not name ${gone}`).not.toContain(gone);
    }
    expect(systemNames).toContain('TenantSchema');
    expect(systemNames).toContain('TenantIsolationLevel');

    // 2. The removed contracts: `./contracts` keeps its surface but the
    //    declared-only provisioning pair is gone.
    const contractsExports = exportsOf('./contracts');
    expect(contractsExports.length, './contracts must export a non-trivial surface').toBeGreaterThan(50);
    const contractsNames = contractsExports.map((e) => e.getName());
    for (const gone of ['IProvisioningService', 'ITenantRouter', 'ResolvedTenantContext']) {
      expect(contractsNames, `./contracts must not name ${gone}`).not.toContain(gone);
    }
    expect(contractsNames).toContain('ISchemaDiffService');

    // 3. The surviving side: `./cloud` exports the const and its inferred
    //    type, declared in cloud/tenant.zod.ts.
    const cloudExports = exportsOf('./cloud');
    const cloudConst = cloudExports.find((e) => e.getName() === 'TenantPlanSchema');
    const cloudType = cloudExports.find((e) => e.getName() === 'TenantPlan');
    expect(cloudConst, './cloud must export `TenantPlanSchema`').toBeTruthy();
    expect(cloudType, './cloud must export `TenantPlan`').toBeTruthy();
    const constOrigin = originOf(cloudConst!, './cloud TenantPlanSchema');
    const typeOrigin = originOf(cloudType!, './cloud TenantPlan');
    expect(constOrigin).toMatch(/^src\/cloud\/tenant\.zod\.ts:\d+$/);
    expect(typeOrigin).toMatch(/^src\/cloud\/tenant\.zod\.ts:\d+$/);

    // 4. Uniqueness — the dual-source pin proper: across EVERY public entry,
    //    an export named `TenantPlan` / `TenantPlanSchema` must resolve to
    //    that ONE cloud declaration — and `./system` must not be a holder at
    //    all, so even a same-symbol re-export (invisible to the dual-source
    //    gate) violates the ruling and turns this red.
    const holders: Record<string, string[]> = { TenantPlan: [], TenantPlanSchema: [] };
    const canonical: Record<string, string> = {
      TenantPlan: typeOrigin,
      TenantPlanSchema: constOrigin,
    };
    for (const sub of Object.keys(entries)) {
      for (const name of Object.keys(holders)) {
        for (const sym of exportsOf(sub).filter((e) => e.getName() === name)) {
          holders[name].push(sub);
          expect(
            originOf(sym, `${sub} ${name}`),
            `${sub} must resolve \`${name}\` to the cloud declaration`,
          ).toBe(canonical[name]);
        }
      }
    }
    expect(holders.TenantPlanSchema).toContain('./cloud');
    expect(holders.TenantPlanSchema).not.toContain('./system');
    expect(holders.TenantPlan).toContain('./cloud');
    expect(holders.TenantPlan).not.toContain('./system');

    // 5. The retired contract interfaces exist in NO entry any more.
    for (const sub of Object.keys(entries)) {
      const names = exportsOf(sub).map((e) => e.getName());
      for (const gone of ['IProvisioningService', 'ITenantRouter', 'ResolvedTenantContext']) {
        expect(names, `${sub} must not name ${gone}`).not.toContain(gone);
      }
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const cloud = await import('./index');
    const system = await import('../system/index');
    expect('TenantPlanSchema' in cloud).toBe(true);
    expect('TenantPlanSchema' in system).toBe(false);
    expect('TenantProvisioningRequestSchema' in system).toBe(false);
    expect('TenantProvisioningResultSchema' in system).toBe(false);
    expect('TenantRegionSchema' in system).toBe(false);
    expect('ProvisioningStepSchema' in system).toBe(false);
  });

  it('what the name now unambiguously means: the 5-value cloud plan vocabulary', () => {
    // The full surviving vocabulary — an enum def has no authorable keys, so
    // the vocabulary IS the surface this pin protects.
    for (const plan of ['free', 'starter', 'pro', 'enterprise', 'custom']) {
      expect(() => TenantPlanSchema.parse(plan)).not.toThrow();
    }
    // `starter` / `custom` are the values the deleted 3-value system subset
    // rejected: their acceptance proves the survivor is the cloud declaration,
    // not the provisioning one.
    expect(TenantPlanSchema.parse('starter')).toBe('starter');
    // And it is still a closed enum, not an open string.
    expect(() => TenantPlanSchema.parse('solo')).toThrow();
    expect(() => TenantPlanSchema.parse('')).toThrow();
  });
});
