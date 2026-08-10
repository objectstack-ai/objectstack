// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ManifestSchema } from './manifest.zod';

// ─── [#4914] `manifest.loading` and the PluginLoadingConfig block are REMOVED ──
//
// ADR-0049 enforce-or-remove, maintainer ruling 2026-08-04, ruled REMOVE. The
// block declared a complete plugin loading policy — strategy, preload, code
// splitting, dynamic import, initialization, dependency resolution, hot reload,
// caching, sandboxing and performance budgets — and nothing read any of it: a
// bare-name scan of objectstack, cloud and objectui (each with a control probe)
// put every reference inside `packages/spec` itself.
//
// `sandboxing` is what made it a security concern rather than tidying: it
// declared process / vm / iframe / web-worker isolation, IPC transports and an
// `allowedServices` ACL, so an author (ADR-0033: very often an AI) read the
// vocabulary as proof the platform isolates plugins, wrote the config, and got a
// clean parse and zero isolation.
//
// Route: `retiredKey()` tombstone, NOT plain deletion. `ManifestSchema` is not
// `.strict()`, so deleting the key would make zod strip it in silence —
// replacing an inert declaration with an invisible one (the #3726 / #3733 shape,
// ADR-0104). The tombstone is audible in two channels: `tsc` (the key's input
// type is `never`) and the parse below.
//
// ⚠️ On the assertion set. The dispatch asked for the ADR-0112 rejection
// envelope (`code` + `status`) as the floor for a rejection-class case. That
// envelope belongs to the API error surface — `ApiErrorSchema`, the
// `ERROR_CODE_LEDGER` vocabulary and an HTTP status — and a schema tombstone
// does not raise one: it raises a `ZodError`, whose issues carry `code` and
// `path` but have no `status` field at all (measured, not assumed). Asserting a
// `status` here would be a fabrication that reads as verification, so these
// pins assert the strongest set this surface really has — refusal, the issue
// `code`, the `path` naming WHICH key was refused, and the prescription text
// (#5240: where the wording is the contract, pin the wording). That set still
// satisfies what #6142 is actually after: it goes red if the refusal moves to
// the wrong key, loses its code, or stops carrying the fix — none of which a
// bare `toThrow()` can see.
describe('[#4914] manifest.loading retirement', () => {
  /** A manifest that is valid except for whatever the individual test adds. */
  const baseManifest = {
    id: 'com.example.plugin',
    namespace: 'example',
    version: '1.0.0',
    type: 'app',
    name: 'Example Plugin',
  } as const;

  it('REJECTS an authored `loading` block, naming the key and carrying the fix', () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      loading: { strategy: 'lazy' },
    });

    expect(result.success).toBe(false);
    if (result.success) return; // narrowing; the assertion above already failed

    const issue = result.error.issues.find((i) => i.path[0] === 'loading');
    expect(issue, 'the refusal must name `loading`').toBeDefined();
    // The machine-readable half of the envelope this surface actually has.
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['loading']);
    // The prescription itself — this string IS the migration doc for whoever
    // hits it, so it is contract, not commentary.
    expect(issue!.message).toMatch(/`manifest\.loading`.*removed.*17\.0\.0.*#4914/s);
    expect(issue!.message).toMatch(/Delete the key/s);
  });

  it('REJECTS the sandboxing block specifically, since that is the dangerous one', () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      loading: { sandboxing: { enabled: true, isolationLevel: 'process' } },
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'loading');
    expect(issue!.code).toBe('invalid_type');
    // The prescription must say plainly that no isolation was ever applied —
    // an author who believed otherwise has a security decision to revisit, and
    // silence here is what made the inert key dangerous in the first place.
    expect(issue!.message).toMatch(/never isolated anything/s);
    expect(issue!.message).toMatch(/manifest\.runtime/s);
  });

  it('REJECTS hotReload too, and points at the surviving vocabulary', () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      loading: { hotReload: { enabled: true, strategy: 'state-preserve' } },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === 'loading')!.code).toBe('invalid_type');
  });

  it('parses cleanly once the key is deleted, and grows no `loading` property', () => {
    const parsed = ManifestSchema.parse({ ...baseManifest });
    expect(parsed.id).toBe('com.example.plugin');
    // The non-strict strip path: absence must stay absence. If the tombstone
    // were ever replaced by a plain deletion, an authored `loading` would be
    // stripped here in silence — this pin plus the rejection above are what
    // make that regression loud.
    expect(parsed).not.toHaveProperty('loading');
  });

  it('does not export the retired loading-config schemas from ./kernel', async () => {
    const kernel = await import('./index');
    const retired = [
      'PluginLoadingConfigSchema',
      'PluginLoadingStrategySchema',
      'PluginPreloadConfigSchema',
      'PluginCodeSplittingSchema',
      'PluginDynamicImportSchema',
      'PluginInitializationSchema',
      'PluginDependencyResolutionSchema',
      'PluginHotReloadSchema',
      'PluginCachingSchema',
      'PluginSandboxingSchema',
      'PluginPerformanceMonitoringSchema',
    ];
    for (const name of retired) {
      expect(kernel, `${name} must not be exported after #4914`).not.toHaveProperty(name);
    }

    // Anti-vacuity: this pin is only meaningful if the barrel really resolved
    // and still exports the neighbours that SURVIVE the retirement — the two
    // observational shapes from the same module, and the hot-reload vocabulary
    // the ruling deliberately kept (§2: `HotReloadConfigSchema` has an
    // implementation body, `HotReloadManager`, and is the starting point for a
    // FUTURE enforce decision — this change must not remove it).
    expect(kernel).toHaveProperty('PluginLoadingEventSchema');
    expect(kernel).toHaveProperty('PluginLoadingStateSchema');
    expect(kernel).toHaveProperty('HotReloadConfigSchema');
    expect(kernel).toHaveProperty('ManifestSchema');
  });
});
