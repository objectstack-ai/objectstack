// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { PluginSecurityManifestSchema } from './plugin-security-advanced.zod';
import { PluginQualityMetricsSchema } from './plugin-registry.zod';

// ─── [#15932] the plugin-security SCAN-RESULT family is REMOVED ───────────────
//
// ADR-0049 enforce-or-remove; director seat, decision batch #65, 2026-09-07,
// maintainer verbatim 「同意」. Four members, one family:
//
//   - `KernelSecurityScanResult`      — whole def, out of the build
//   - `KernelSecurityVulnerability`   — whole def, out of the build
//   - `PluginSecurityManifest.scanResults`     — tombstoned key
//   - `PluginQualityMetrics.securityScan`      — tombstoned key
//
// plus `PluginSecurityManifest.vulnerabilities`, the last authorable referent of
// the second def and therefore a forced consequence of retiring it.
//
// This is the second half of #14919, which retired `PluginSecurityScanner` — the
// `@objectstack/core` class that shipped as a security control and returned
// `status: "passed"` for every plugin it was ever handed. That scanner was the
// family's ONLY importer of any kind (a type-only import), so its deletion moved
// these schemas from one type-only importer to zero consumers while they stayed
// fully published on the authorable surface.
//
// ⚠️ On the assertion set. A schema tombstone raises a `ZodError`, not the
// ADR-0112 envelope: its issues carry `code` and `path` and have no `status`
// field at all. So these pins assert the strongest set this surface really has —
// refusal, the issue `code`, the `path` naming WHICH key was refused, and the
// prescription text (where the wording is the contract, pin the wording). A bare
// `toThrow()` would stay green if the refusal moved to the wrong key or stopped
// carrying the fix.

/** A manifest that is valid except for whatever an individual test adds. */
const baseManifest = {
  pluginId: 'com.example.plugin',
  trustLevel: 'community',
  permissions: { permissions: [] },
  sandbox: {},
} as const;

describe('[#15932] plugin-security scan-result retirement', () => {
  it('REJECTS an authored `scanResults` array, naming the key and carrying the fix', () => {
    const result = PluginSecurityManifestSchema.safeParse({
      ...baseManifest,
      scanResults: [{ timestamp: '2026-01-15T10:00:00Z', status: 'passed' }],
    });

    expect(result.success).toBe(false);
    if (result.success) return; // narrowing; the assertion above already failed

    const issue = result.error.issues.find((i) => i.path[0] === 'scanResults');
    expect(issue, 'the refusal must name `scanResults`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['scanResults']);
    // The prescription IS the migration doc for whoever hits it — contract, not
    // commentary. It must say the removal happened, and must NOT send the reader
    // looking for a replacement key that does not exist.
    expect(issue!.message).toMatch(/`PluginSecurityManifest\.scanResults`.*removed.*ADR-0049/s);
    expect(issue!.message).toMatch(/Delete the key/s);
    expect(issue!.message).toMatch(/no replacement key/s);
    // An author who read a clean scan as evidence of safety has a security
    // decision to revisit; silence here is what made the inert key dangerous.
    expect(issue!.message).toMatch(/never that it is safe/s);
  });

  it('REJECTS the sibling `vulnerabilities` list, which left with its value type', () => {
    const result = PluginSecurityManifestSchema.safeParse({
      ...baseManifest,
      vulnerabilities: [{ id: 'V-1', severity: 'critical', title: 't', description: 'd', affectedVersions: [] }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'vulnerabilities');
    expect(issue, 'the refusal must name `vulnerabilities`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(/`PluginSecurityManifest\.vulnerabilities`.*removed/s);
    expect(issue!.message).toMatch(/blocked\s+no install/s);
  });

  it('REJECTS `PluginQualityMetrics.securityScan`, the member that published a VERDICT', () => {
    const result = PluginQualityMetricsSchema.safeParse({
      testCoverage: 85,
      securityScan: { lastScanDate: '2026-01-15T10:00:00Z', passed: true },
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'securityScan');
    expect(issue, 'the refusal must name `securityScan`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['securityScan']);
    expect(issue!.message).toMatch(/`PluginQualityMetrics\.securityScan`.*removed.*ADR-0049/s);
    // The prescription must say plainly what the verdict was worth, because a
    // consumer that gated on `passed: true` was gating on nothing.
    expect(issue!.message).toMatch(/`passed: true` with nothing at all behind it/s);
    expect(issue!.message).toMatch(/Delete the key/s);
  });

  it('parses cleanly once the keys are deleted, and grows no such property', () => {
    // Absence must stay absence. Neither carrying shape is `.strict()`, so a bare
    // deletion would have stripped an authored key in SILENCE (ADR-0104) — this
    // pin plus the refusals above are what keep the tombstones honest.
    const manifest = PluginSecurityManifestSchema.parse({ ...baseManifest });
    expect(manifest.pluginId).toBe('com.example.plugin');
    expect(manifest).not.toHaveProperty('scanResults');
    expect(manifest).not.toHaveProperty('vulnerabilities');

    const metrics = PluginQualityMetricsSchema.parse({ testCoverage: 85, codeQuality: 75 });
    expect(metrics.testCoverage).toBe(85);
    expect(metrics).not.toHaveProperty('securityScan');
  });

  it('does not export the retired scan-result defs from ./kernel', async () => {
    const kernel = await import('./index');
    for (const name of ['KernelSecurityScanResultSchema', 'KernelSecurityVulnerabilitySchema']) {
      expect(kernel, `${name} must not be exported after #15932`).not.toHaveProperty(name);
    }

    // Anti-vacuity: this pin means nothing unless the barrel really resolved and
    // still exports the neighbours that SURVIVE. Three groups, each load-bearing:
    // the manifest's own surviving security vocabulary; the sibling quality
    // metrics; and — the scope fence — the SEPARATELY DECLARED, unprefixed pair
    // in `plugin-security.zod.ts`, which is a different family with its own
    // self-test and is deliberately NOT part of this retirement.
    expect(kernel).toHaveProperty('PluginSecurityManifestSchema');
    expect(kernel).toHaveProperty('KernelSecurityPolicySchema');
    expect(kernel).toHaveProperty('SandboxConfigSchema');
    expect(kernel).toHaveProperty('PluginQualityMetricsSchema');
    expect(kernel).toHaveProperty('SecurityScanResultSchema');
    expect(kernel).toHaveProperty('SecurityVulnerabilitySchema');
  });
});
