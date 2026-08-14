// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MetadataPluginConfigSchema, MetadataPluginManifestSchema } from './metadata-plugin.zod';

// ─── [#8586] `MetadataPluginConfig.additionalTypes` is REMOVED ────────────────
//
// ADR-0049 enforce-or-remove, maintainer ruling 2026-08-14, ruled REMOVE. The
// key was declared, authorable, and documented on four docs pages as THE way a
// plugin registers a custom metadata type — and read by NOTHING: the only
// production writer of the manager's type registry is
// `setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY)` (`packages/metadata/src/
// plugin.ts`), called exactly once, and it replaces the array outright.
// Measured on the real `MetadataManager`: declared count == live count
// (27 == 27). The same silence trap as #4212's `onInstall`, one level down:
// write it per the docs, get no error, nothing happens.
//
// Route: `retiredKey()` tombstone, NOT plain deletion.
// `MetadataPluginConfigSchema` is not `.strict()`, so deleting the key would
// make zod strip it in silence — replacing an inert declaration with an
// invisible one (the #3726 / #3733 shape, ADR-0104). The tombstone is audible
// in two channels: `tsc` (the key's input type is `never`) and the parse below.
//
// ⚠️ On the assertion set (the #4914 precedent, same reasoning): the dispatch
// asked for the unknown-key refusal shape, but that shape belongs to `.strict()`
// schemas — a `retiredKey()` tombstone raises `invalid_type` from its
// `z.never()`, with the prescription as the message (`shared/retired-key.ts`;
// `alias-integrity.test.ts` records the same fact). And the ADR-0112 `code` +
// `status` envelope belongs to the API error surface — a schema refusal raises
// a `ZodError` whose issues carry `code` and `path` but no `status`. So these
// pins assert the strongest set this surface really has: refusal, the issue
// `code`, the `path` naming WHICH key was refused, and the prescription text
// (#5240: where the wording is the contract, pin the wording).
describe('[#8586] MetadataPluginConfig.additionalTypes retirement', () => {
  /** A config that is valid except for whatever the individual test adds. */
  const baseConfig = { storage: {} } as const;

  it('REJECTS an authored `additionalTypes`, naming the key and carrying the fix', () => {
    const result = MetadataPluginConfigSchema.safeParse({
      ...baseConfig,
      additionalTypes: [{
        type: 'chart',
        label: 'Chart',
        filePatterns: ['**/*.chart.ts'],
        domain: 'ui',
      }],
    });

    expect(result.success).toBe(false);
    if (result.success) return; // narrowing; the assertion above already failed

    const issue = result.error.issues.find((i) => i.path[0] === 'additionalTypes');
    expect(issue, 'the refusal must name `additionalTypes`').toBeDefined();
    // The machine-readable half of the envelope this surface actually has.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['additionalTypes']);
    // The prescription itself — this string IS the migration doc for whoever
    // hits it, so it is contract, not commentary.
    expect(issue!.message).toMatch(/`config\.additionalTypes`.*removed.*17.*#8586/s);
    expect(issue!.message).toMatch(/Delete the key/s);
    // The live mechanism must be named: how a kind ACTUALLY enters the set.
    expect(issue!.message).toMatch(/registering an ITEM/s);
    expect(issue!.message).toMatch(/registerMetadataTypeSchema/s);
  });

  it('REJECTS it through the manifest embed too (`config.additionalTypes`)', () => {
    const result = MetadataPluginManifestSchema.safeParse({
      id: 'com.objectstack.metadata',
      name: 'ObjectStack Metadata Service',
      version: '1.0.0',
      type: 'standard',
      capabilities: {},
      config: { ...baseConfig, additionalTypes: [] },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path[0] === 'config' && i.path[1] === 'additionalTypes',
    );
    expect(issue, 'the refusal must surface at config.additionalTypes').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
  });

  it('parses cleanly once the key is deleted, and grows no `additionalTypes` property', () => {
    const parsed = MetadataPluginConfigSchema.parse({ ...baseConfig });
    expect(parsed.enableEvents).toBe(true); // control: defaults still apply
    // The non-strict strip path: absence must stay absence. If the tombstone
    // were ever replaced by a plain deletion, an authored `additionalTypes`
    // would be stripped here in silence — this pin plus the rejections above
    // are what make that regression loud.
    expect(parsed).not.toHaveProperty('additionalTypes');
  });
});
