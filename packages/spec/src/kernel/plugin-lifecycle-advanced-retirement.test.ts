// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#11825] The authorable lifecycle-config surface is RETIRED ────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-08-25 (route 2).
// `kernel/plugin-lifecycle-advanced.zod.ts` no longer declares
// `AdvancedPluginLifecycleConfigSchema` (the aggregating
// `{ health, hotReload, degradation, updates, resources, observability }`
// config container), `GracefulDegradationSchema` or
// `PluginUpdateStrategySchema` — 3 emitted defs, 9 exported names, 17
// authorable-surface keys, the reference page's sections with them.
//
// The measurement that decided it (re-run per group at this retirement's base
// commit, 8cdd696, with positive controls — the full record lives in the
// retirement block inside the zod module):
//
//   1. WIRING — no runtime constructs `PluginHealthMonitor` or
//      `HotReloadManager`; the only constructions are their own unit tests
//      and `core/examples/phase2-integration.ts`, and every one passes the
//      config DIRECTLY to the class, never through this container.
//   2. STATIC — zero readers of any `degradation` / `updates` / `resources` /
//      `observability` key in objectstack or objectui outside `packages/spec`
//      itself (controls: `checkMethod` resolves to
//      `core/src/health-monitor.ts`, `debounceDelay` to
//      `core/src/hot-reload.ts` — the scan sees real readers).
//   3. DOORS — no metadata-type binding, no stack collection, no manifest
//      embed: no authored document could ever carry the container.
//
// Route 3: with no carrier key there is nothing to tombstone and no seam for
// a D2 conversion — `RETIRED_DEFS_BY_MAJOR[18]` plus the D3 semantic entry
// `advanced-plugin-lifecycle-config-retired` ARE the declaration.
//
// Form follows #8715 / #4988 / #5055: resolved symbol identity over every
// public entry via the build-time `export-origins/` artifact.
describe('[#11825] kernel/ AdvancedPluginLifecycleConfig retirement', () => {
  /** The 9 names the retired defs exported (3 schema consts + 6 types). */
  const RETIRED_NAMES = [
    'AdvancedPluginLifecycleConfigSchema',
    'AdvancedPluginLifecycleConfig',
    'AdvancedPluginLifecycleConfigParsed',
    'GracefulDegradationSchema',
    'GracefulDegradation',
    'GracefulDegradationParsed',
    'PluginUpdateStrategySchema',
    'PluginUpdateStrategy',
    'PluginUpdateStrategyParsed',
  ] as const;

  /**
   * Names that must SURVIVE on `./kernel`: the input vocabularies of the
   * host-driven library classes the ruling keeps (`PluginHealthMonitor` /
   * `HotReloadManager` in `@objectstack/core` — the #11811 lifecycle.mdx
   * examples are the supported usage). Exactly what a too-wide "tidy the
   * lifecycle module" sweep would take.
   */
  const MUST_SURVIVE_KERNEL = [
    'PluginHealthStatusSchema',
    'PluginHealthCheckSchema',
    'PluginHealthReportSchema',
    'HotReloadConfigSchema',
    // 'DistributedStateConfigSchema' — MOVED OUT by #12340, see below.
    'PluginStateSnapshotSchema',
    'PluginHealthCheckParsed',
    'HotReloadConfigParsed',
    'PluginStateSnapshot',
  ] as const;

  /**
   * [#12340] The one name this ruling's survivor list NAMED and a later card
   * removed anyway.
   *
   * Not a quiet edit to make a red pin green — the reversal is the finding.
   * #11825 measured the CONTAINER's six groups and kept `HotReloadConfig`
   * "with its embedded `DistributedStateConfig`" as a library parameter type.
   * It never measured THIS key's own readers. #12340 did, at cdbd9204b6 with
   * a firing positive control, and found zero: an author could name a Redis
   * endpoint, a TTL and a replication factor, and nothing ever opened a
   * connection. Its only referencing key (`HotReloadConfig.distributedConfig`)
   * left with the `stateStrategy: 'distributed'` value it was documented as
   * being "required" for, so the schema had nothing left to be the vocabulary
   * OF.
   *
   * The keep itself is intact and still pinned above: `HotReloadConfigSchema`
   * survives, `HotReloadManager` survives. What #12340 removed is the part of
   * the kept vocabulary that was itself declared-but-unenforced — the same
   * ADR-0049 test that retired the container, applied one level in.
   */
  const RETIRED_BY_12340 = ['DistributedStateConfigSchema', 'DistributedStateConfig',
    'DistributedStateConfigParsed'] as const;

  it('[#12340] the distributed-state vocabulary has zero holders too', () => {
    // Anti-vacuity: the same baseline the sibling assertion relies on.
    expect(exportNamesOf('./kernel').length).toBeGreaterThan(50);
    for (const name of RETIRED_BY_12340) {
      expect(holdersOf(name), `${name} must have zero holders after #12340`).toEqual([]);
    }
    // The keep it was carved out of is UNTOUCHED — this is the assertion that
    // makes the removal a narrowing rather than the "too-wide sweep" the
    // survivor list was written to stop.
    expect(exportNamesOf('./kernel')).toContain('HotReloadConfigSchema');
    expect(exportNamesOf('./kernel')).toContain('PluginStateSnapshotSchema');
  });

  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './kernel']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(
      exportNamesOf('./kernel').length,
      './kernel must export a non-trivial surface'
    ).toBeGreaterThan(50);

    // ── ABSENCE (every entry, not just ./kernel) ──────────────────────────
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #11825`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    const kernelNames = exportNamesOf('./kernel');
    for (const name of MUST_SURVIVE_KERNEL) {
      expect(kernelNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the runtime barrel resolves without the retired names and keeps the survivors', async () => {
    const kernel = await import('./index');
    for (const name of [
      'AdvancedPluginLifecycleConfigSchema',
      'GracefulDegradationSchema',
      'PluginUpdateStrategySchema',
    ]) {
      expect(kernel, `${name} must not be exported after #11825`).not.toHaveProperty(name);
    }
    // Anti-vacuity: the barrel really resolved and still exports the kept
    // library vocabularies (the #4914 §2 keep, restated by this ruling).
    expect(kernel).toHaveProperty('PluginHealthCheckSchema');
    expect(kernel).toHaveProperty('HotReloadConfigSchema');
    // [#12340] gone from the barrel with its def; the keep around it stands.
    expect(kernel).not.toHaveProperty('DistributedStateConfigSchema');
    expect(kernel).toHaveProperty('PluginStateSnapshotSchema');
    expect(kernel).toHaveProperty('ManifestSchema');
  });
});
