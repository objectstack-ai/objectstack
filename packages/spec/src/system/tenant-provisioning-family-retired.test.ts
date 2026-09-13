// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
// ─── [#4739] the system-side provisioning family stays retired ──────────────
//
// `./cloud` and `./system` both exported a `TenantPlan` + `TenantPlanSchema`
// for two different declarations (the #4411 trap — which vocabulary a consumer
// got depended on the import path). Maintainer ruling on #4739 (ledger #4535
// C16): route B — delete the system-side provisioning family
// (`system/provisioning.zod.ts`: TenantPlan / TenantRegion /
// TenantProvisioningStatus / ProvisioningStep / TenantProvisioningRequest /
// TenantProvisioningResult) and its declared-only contracts
// (`IProvisioningService` / `ITenantRouter` / `ResolvedTenantContext` in
// `./contracts`); the cloud side keeps the name.
//
// That pin lived in `cloud/tenant.test.ts` beside the surviving declaration.
// #16325 then removed the `./cloud` subpath itself — the cloud control plane's
// contracts, `tenant.zod.ts` included, are the cloud repo's own declarations
// now, not an open-source protocol — so the "cloud keeps the name" half of the
// ruling is no longer this package's to pin. The half that IS still this
// package's is kept here: `./system` and `./contracts` must not re-grow the
// retired family, and — the new fact — `TenantPlan(Schema)` is named by NO
// entry of `@objectstack/spec` at all. A `./system` re-export of anything
// called `TenantPlan` was the forbidden route under #4739 and is still
// forbidden; it now has nothing left to re-export from.
//
// #4642 established that a compile-time conditional-type pin in this package
// was a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the export-origins test below, with
// anti-vacuity guards.
describe('[#4739 / #16325] the system-side provisioning family stays retired, and `TenantPlan` has left the package', () => {
  it('resolves the export surface: ./system and ./contracts name none of the retired family', () => {
    // Anti-vacuity: the baseline must cover the real surface (`export-origins/`
    // IS the resolution, computed at build time and checked in — #4796).
    expect(EXPORT_ENTRY_POINTS).toContain('./system');
    expect(EXPORT_ENTRY_POINTS).toContain('./contracts');
    expect(EXPORT_ENTRY_POINTS).not.toContain('./cloud');
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // 1. `./system` still has a non-trivial surface — so the `not.toContain`
    //    cannot pass by resolving nothing — and names none of the provisioning
    //    family, while its surviving multi-tenant neighbours stand.
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

    // 2. `./contracts` keeps its surface but the declared-only provisioning
    //    pair is gone.
    const contractsNames = exportNamesOf('./contracts');
    expect(contractsNames.length, './contracts must export a non-trivial surface').toBeGreaterThan(50);
    for (const gone of ['IProvisioningService', 'ITenantRouter', 'ResolvedTenantContext']) {
      expect(contractsNames, `./contracts must not name ${gone}`).not.toContain(gone);
    }
    expect(contractsNames).toContain('ISchemaDiffService');

    // 3. Across EVERY public entry: nothing names the retired contracts, and —
    //    since #16325 — nothing names `TenantPlan(Schema)` either. The cloud
    //    declaration that used to be the one legitimate holder left with the
    //    `./cloud` subpath; a holder reappearing anywhere is a second
    //    declaration of a name this package no longer owns.
    for (const gone of [
      'IProvisioningService', 'ITenantRouter', 'ResolvedTenantContext',
      'TenantPlan', 'TenantPlanSchema',
    ]) {
      expect(holdersOf(gone), `no entry may name ${gone}`).toEqual([]);
    }
  });

  it('keeps the runtime namespace consistent with the compiler view', async () => {
    const system = await import('./index');
    // Anti-vacuity: the namespace probed is real and non-trivial.
    expect('TenantSchema' in system).toBe(true);
    expect('TenantPlanSchema' in system).toBe(false);
    expect('TenantProvisioningRequestSchema' in system).toBe(false);
    expect('TenantProvisioningResultSchema' in system).toBe(false);
    expect('TenantRegionSchema' in system).toBe(false);
    expect('ProvisioningStepSchema' in system).toBe(false);
  });
});
