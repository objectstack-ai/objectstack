// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#16059] The startup ORCHESTRATION surface is RETIRED ──────────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling, director seat decision batch
// #60, 2026-09-06. `kernel/startup-orchestrator.zod.ts` no longer declares
// `StartupOptionsSchema` (with its `healthCheck`), `HealthStatusSchema` or
// `StartupOrchestrationResultSchema`, and `contracts/startup-orchestrator.ts`
// no longer declares `IStartupOrchestrator` — 3 emitted defs, 8 exported
// names, the reference page's sections with them.
//
// The measurement that decided it, re-run on this card against this
// retirement's base commit with lit same-corpus controls:
//
//   1. IMPLEMENTERS — nobody. No class or object literal in any repository
//      implements `IStartupOrchestrator`, and nothing calls
//      `orchestrateStartup`, `rollback`, `checkHealth` or `startWithTimeout`
//      on one. Plugin startup is `ObjectKernel.start()` →
//      `startPluginWithTimeout()`, which reads its timeout from
//      `PluginMetadata.startupTimeout` and its rollback policy from
//      `KernelConfig.rollbackOnFailure`.
//   2. PARSERS — nobody. No `.parse` / `.safeParse` of the three schemas
//      outside this module's own tests.
//   3. CROSS-REPO — zero hits for all six names in the pinned `objectui`
//      checkout, controls `defineStack` (27 files) and `ManifestSchema`
//      lighting up on the same corpus. Every remaining hit in this repository
//      was a generated artifact or a released `CHANGELOG.md`.
//
// `healthCheck` and `HealthStatus` are the sharpest of the four: they name a
// per-plugin startup health probe the runtime has never had — the #3950 shape
// an AI author (ADR-0033) reads as proof the capability exists.
//
// Route 3: with no authored document carrying the defs there is no seam for a
// D2 conversion and no author to tombstone for — `RETIRED_DEFS_BY_MAJOR[18]`
// plus the D3 semantic entry `startup-orchestrator-retired` ARE the
// declaration. Form follows #11825 / #8715 / #4988: resolved symbol identity
// over every public entry via the build-time `export-origins/` artifact.
describe('[#16059] startup orchestrator retirement', () => {
  /** The 8 names the retired defs and the retired interface exported. */
  const RETIRED_NAMES = [
    'StartupOptionsSchema',
    'StartupOptions',
    'StartupOptionsParsed',
    'HealthStatusSchema',
    'HealthStatus',
    'StartupOrchestrationResultSchema',
    'StartupOrchestrationResult',
    'IStartupOrchestrator',
  ] as const;

  /**
   * What must SURVIVE, and where. The ruling keeps a startup-result contract
   * describing what the kernel actually produces, so a too-wide "tidy the
   * startup module" sweep that took these with the rest would be the failure
   * this list exists to catch — and `PluginStartupResult` staying on
   * `./contracts` is what keeps a consumer importing from that entry whole.
   */
  const MUST_SURVIVE_KERNEL = ['PluginStartupResultSchema', 'PluginStartupResult'] as const;
  const MUST_SURVIVE_CONTRACTS = ['PluginStartupResult'] as const;

  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './kernel', './contracts']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(
      exportNamesOf('./kernel').length,
      './kernel must export a non-trivial surface'
    ).toBeGreaterThan(50);
    expect(
      exportNamesOf('./contracts').length,
      './contracts must export a non-trivial surface'
    ).toBeGreaterThan(50);

    // ── ABSENCE (every entry, not just the two that declared them) ─────────
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #16059`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    const kernelNames = exportNamesOf('./kernel');
    for (const name of MUST_SURVIVE_KERNEL) {
      expect(kernelNames, `${name} must SURVIVE this retirement on ./kernel`).toContain(name);
    }
    const contractNames = exportNamesOf('./contracts');
    for (const name of MUST_SURVIVE_CONTRACTS) {
      expect(contractNames, `${name} must SURVIVE this retirement on ./contracts`).toContain(name);
    }
  });

  it('the runtime barrels resolve without the retired names and keep the survivor', async () => {
    const kernel = await import('./index');
    for (const name of [
      'StartupOptionsSchema',
      'HealthStatusSchema',
      'StartupOrchestrationResultSchema',
    ]) {
      expect(kernel, `${name} must not be exported after #16059`).not.toHaveProperty(name);
    }
    // Anti-vacuity: the barrel really resolved, and the kept contract stands.
    expect(kernel).toHaveProperty('PluginStartupResultSchema');
    expect(kernel).toHaveProperty('ManifestSchema');
  });

  it('the surviving schema declares the shape @objectstack/core ships', async () => {
    // The point of the ruling: the spec's result and the kernel's result are
    // ONE declaration. If a later edit narrows this schema away from what
    // `startPluginWithTimeout()` returns, core stops compiling — but this
    // asserts the shape here too, so the reason is named at the spec end.
    const { PluginStartupResultSchema } = await import('./startup-orchestrator.zod');
    const shape = (PluginStartupResultSchema as unknown as { shape: Record<string, unknown> }).shape;
    for (const member of ['pluginName', 'success', 'durationMs', 'startTime', 'error', 'timedOut']) {
      expect(Object.keys(shape), `${member} must be declared`).toContain(member);
    }
    // The two members that left the surviving def are tombstones, not
    // deletions — present in the shape, refusing with a prescription.
    for (const member of ['plugin', 'health', 'duration']) {
      expect(Object.keys(shape), `${member} must remain as a tombstone`).toContain(member);
    }
  });
});
