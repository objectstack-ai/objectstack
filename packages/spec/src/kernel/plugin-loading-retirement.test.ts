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
// Route at the time: `retiredKey()` tombstone, NOT plain deletion — then
// `ManifestSchema` was not `.strict()`, so deleting the key would have made zod
// strip it in silence (the #3726 / #3733 shape, ADR-0104). The surface closed
// since, and the tombstone — a 16.x retirement kit — aged out of the shape at
// 18 (#25767, ADR-0087 amendment, D2 = A). What keeps the removal audible now
// is the strict refusal itself: `tsc` (TS2353, the key does not exist on the
// type) and the `unrecognized_keys` issue below, which names the key and the
// protocol upgrade guide the prescription moved to.
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
describe('manifest.loading retirement', () => {
  /** A manifest that is valid except for whatever the individual test adds. */
  const baseManifest = {
    id: 'com.example.plugin',
    namespace: 'example',
    version: '1.0.0',
    type: 'app',
    name: 'Example Plugin',
  } as const;

  /** The one `unrecognized_keys` issue of a refused manifest, naming `loading`. */
  const unknownKeyRefusal = (loading: Record<string, unknown>) => {
    const result = ManifestSchema.safeParse({ ...baseManifest, loading });
    expect(result.success).toBe(false);
    if (result.success) return undefined;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys') as
      | { code: string; keys: string[]; path: PropertyKey[]; message: string }
      | undefined;
    expect(issue, 'the refusal must be the strict unknown-key one').toBeDefined();
    return issue!;
  };

  it('REFUSES an authored `loading` block as an unknown key, naming the key and the upgrade guide', () => {
    const issue = unknownKeyRefusal({ strategy: 'lazy' })!;
    // The machine-readable half of the envelope this surface actually has.
    expect(issue.keys).toEqual(['loading']);
    expect(issue.path).toEqual([]);
    // No tombstone issue beside it: the key is unknown now, not declared `never`.
    expect(ManifestSchema.safeParse({ ...baseManifest, loading: { strategy: 'lazy' } }).error!.issues
      .filter((i) => i.path[0] === 'loading')).toEqual([]);
    // Where the prescription (sandboxing never isolated anything; the trust
    // tier is `manifest.runtime`) now lives — the message says so.
    expect(issue.message).toContain('https://objectstack.ai/docs/protocol-upgrade');
  });

  it('REFUSES the sandboxing block the same way — the dangerous one is not stripped in silence', () => {
    // An author who believed the block isolated anything has a security
    // decision to revisit; a clean parse here is exactly what made the inert
    // key dangerous, and the strict refusal is what forbids it.
    const issue = unknownKeyRefusal({ sandboxing: { enabled: true, isolationLevel: 'process' } })!;
    expect(issue.keys).toEqual(['loading']);
  });

  it('REFUSES hotReload too', () => {
    expect(unknownKeyRefusal({ hotReload: { enabled: true, strategy: 'state-preserve' } })!.keys).toEqual(['loading']);
  });

  it('parses cleanly once the key is deleted, and grows no `loading` property', () => {
    const parsed = ManifestSchema.parse({ ...baseManifest });
    expect(parsed.id).toBe('com.example.plugin');
    // Absence must stay absence. `ManifestSchema` is closed, which is the whole
    // reason the tombstone could age out without the key going silent again.
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
      expect(kernel, `${name} must not be exported after its retirement`).not.toHaveProperty(name);
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
