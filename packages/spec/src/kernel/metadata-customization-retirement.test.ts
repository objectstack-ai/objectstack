// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MetadataPluginConfigSchema } from './metadata-plugin.zod';
import { MetadataManagerConfigSchema } from './metadata-loader.zod';

// ─── [#13135] The paper metadata-customization protocol is REMOVED ────────────
//
// ADR-0049 enforce-or-remove, executing the maintainer ruling of 2026-08-29 on
// #12057 (「同意」 — retirement adopted; re-scope rejected). ADR-0126 §6 wall 4
// supersedes the protocol on the record: "nothing may build against it". The
// module `kernel/metadata-customization.zod.ts` is deleted whole; these pins
// cover the three AUTHORABLE keys that embedded it and survive as tombstones:
//
//   - `MetadataPluginConfig.customizationPolicies` (embedded
//     `CustomizationPolicySchema`) — read by nothing; no code ever consulted
//     a policy before accepting or refusing a customization.
//   - `MetadataPluginConfig.mergeStrategy` (embedded
//     `MergeStrategyConfigSchema`) — read by nothing; no 3-way merge engine
//     ever existed, and package upgrades never merge customizations
//     (ADR-0126 §6 wall 3).
//   - `MetadataManagerConfig.persistence.overlayWritable` — gated only
//     `MetadataManager.saveOverlay()`, a paper-protocol method reachable
//     only from its own unit tests (no route or UI ever called it), removed
//     with the protocol.
//
// Route: `retiredKey()` tombstones, NOT plain deletions — neither carrier
// schema (nor the nested `persistence` object) is `.strict()`, so deleting a
// key would make zod strip it in silence (the #3726 / #3733 shape, ADR-0104).
// The assertion set follows the #8586 `additionalTypes` precedent in this
// directory: refusal, the issue `code`, the `path` naming WHICH key was
// refused, and the prescription text (#5240: where the wording is the
// contract, pin the wording).
describe('[#13135] paper metadata-customization protocol retirement', () => {
  /** A config that is valid except for whatever the individual test adds. */
  const baseConfig = { storage: {} } as const;

  it('REJECTS an authored `customizationPolicies`, naming the key and carrying the fix', () => {
    const result = MetadataPluginConfigSchema.safeParse({
      ...baseConfig,
      customizationPolicies: [{
        metadataType: 'object',
        lockedFields: ['name', 'fields.*.type'],
      }],
    });

    expect(result.success).toBe(false);
    if (result.success) return; // narrowing; the assertion above already failed

    const issue = result.error.issues.find((i) => i.path[0] === 'customizationPolicies');
    expect(issue, 'the refusal must name `customizationPolicies`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['customizationPolicies']);
    // The prescription IS the migration doc for whoever hits it.
    expect(issue!.message).toMatch(/`config\.customizationPolicies`.*removed.*17/s);
    expect(issue!.message).toMatch(/Delete the key/s);
    // The live mechanisms must be named.
    expect(issue!.message).toMatch(/allowOrgOverride/s);
    expect(issue!.message).toMatch(/ADR-0126/s);
  });

  it('REJECTS an authored `mergeStrategy`, naming the key and carrying the fix', () => {
    const result = MetadataPluginConfigSchema.safeParse({
      ...baseConfig,
      mergeStrategy: { defaultStrategy: 'three-way-merge' },
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'mergeStrategy');
    expect(issue, 'the refusal must name `mergeStrategy`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['mergeStrategy']);
    expect(issue!.message).toMatch(/`config\.mergeStrategy`.*removed.*17/s);
    expect(issue!.message).toMatch(/Delete the key/s);
    // The model that replaces a configurable strategy must be named.
    expect(issue!.message).toMatch(/upgrades\s+rewrite the packaged base/s);
  });

  it('REJECTS an authored `persistence.overlayWritable`, naming the nested path', () => {
    const result = MetadataManagerConfigSchema.safeParse({
      persistence: { writable: true, overlayWritable: false },
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find(
      (i) => i.path[0] === 'persistence' && i.path[1] === 'overlayWritable',
    );
    expect(issue, 'the refusal must surface at persistence.overlayWritable').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.message).toMatch(/`persistence\.overlayWritable`.*removed.*17/s);
    expect(issue!.message).toMatch(/Delete the key/s);
    // The gate that remains must be named.
    expect(issue!.message).toMatch(/`persistence\.writable`/s);
  });

  it('parses cleanly once the keys are deleted, and grows none of them back', () => {
    const parsed = MetadataPluginConfigSchema.parse({ ...baseConfig });
    expect(parsed.enableEvents).toBe(true); // control: defaults still apply
    // The non-strict strip path: absence must stay absence. If a tombstone
    // were ever replaced by a plain deletion, an authored key would be
    // stripped here in silence — these pins plus the rejections above are
    // what make that regression loud.
    expect(parsed).not.toHaveProperty('customizationPolicies');
    expect(parsed).not.toHaveProperty('mergeStrategy');

    const managerParsed = MetadataManagerConfigSchema.parse({
      persistence: { writable: false },
    });
    expect(managerParsed.persistence?.writable).toBe(false); // control
    expect(managerParsed.persistence).not.toHaveProperty('overlayWritable');
  });
});
