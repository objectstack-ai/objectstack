// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { TenantPlanSchema } from './tenant.zod';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
  maybeOriginOf,
  originFileOf,
  originOf,
  originsOf,
} from '../../scripts/lib/export-origins-testkit';
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
// was a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR.
describe('[#4739] `TenantPlan(Schema)` resolves to the ./cloud declaration everywhere', () => {
  it('resolves the export surface: only ./cloud declares `TenantPlan(Schema)`; the provisioning family is gone', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796.)
    expect(EXPORT_ENTRY_POINTS).toContain('./cloud');
    expect(EXPORT_ENTRY_POINTS).toContain('./system');
    expect(EXPORT_ENTRY_POINTS).toContain('./contracts');
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // 1. The removed side: `./system` still has a non-trivial surface — so
    //    the `not.toContain` cannot pass by resolving nothing — and no longer
    //    names any of the provisioning family, while its surviving
    //    multi-tenant neighbours stand.
    const systemNames = exportNamesOf('./system');
    expect(systemNames.length, './system must export a non-trivial surface').toBeGreaterThan(100);
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
    const contractsNames = exportNamesOf('./contracts');
    expect(contractsNames.length, './contracts must export a non-trivial surface').toBeGreaterThan(50);
    for (const gone of ['IProvisioningService', 'ITenantRouter', 'ResolvedTenantContext']) {
      expect(contractsNames, `./contracts must not name ${gone}`).not.toContain(gone);
    }
    expect(contractsNames).toContain('ISchemaDiffService');

    // 3. The surviving side: `./cloud` exports the const and its inferred
    //    type, declared in cloud/tenant.zod.ts.
    expect(maybeOriginOf('./cloud', 'TenantPlanSchema'), './cloud must export `TenantPlanSchema`').toBeDefined();
    expect(maybeOriginOf('./cloud', 'TenantPlan'), './cloud must export `TenantPlan`').toBeDefined();
    expect(originFileOf('./cloud', 'TenantPlanSchema')).toBe('src/cloud/tenant.zod.ts');
    expect(originFileOf('./cloud', 'TenantPlan')).toBe('src/cloud/tenant.zod.ts');

    // 4. Uniqueness — the dual-source pin proper: across EVERY public entry,
    //    an export named `TenantPlan` / `TenantPlanSchema` must resolve to
    //    that ONE cloud declaration — and `./system` must not be a holder at
    //    all, so even a same-symbol re-export (invisible to the dual-source
    //    gate) violates the ruling and turns this red.
    for (const name of ['TenantPlan', 'TenantPlanSchema'] as const) {
      expect(
        originsOf(name),
        `every entry must resolve \`${name}\` to the cloud declaration`,
      ).toEqual([originOf('./cloud', name)]);
      expect(holdersOf(name)).toContain('./cloud');
      expect(holdersOf(name)).not.toContain('./system');
    }

    // 5. The retired contract interfaces exist in NO entry any more.
    for (const gone of ['IProvisioningService', 'ITenantRouter', 'ResolvedTenantContext']) {
      expect(holdersOf(gone), `no entry may name ${gone}`).toEqual([]);
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
