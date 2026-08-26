// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#12007] kernel/ CLICommandContribution is RETIRED ─────────────────────
//
// ADR-0049 enforce-or-remove. `kernel/cli-extension.zod.ts` no longer declares
// `CLICommandContributionSchema` / `CLICommandContribution` — 1 emitted def,
// 2 exported names, 3 authorable-surface keys (`name`, `description`,
// `module`), the reference page's section with them.
//
// The measurement that decided it (re-verified at this retirement's base
// commit, 146f448a5, with positive controls — the full record lives in the
// retirement block inside the zod module):
//
//   1. CARRIER — after #10724, `manifest.contributes.commands` is a
//      `retiredKey()` tombstone: no manifest surface could legally carry a
//      command-contribution entry, so the exported schema advertised a shape
//      whose only declared carrier rejects it. The manifest never referenced
//      this schema even before the tombstone — its inline `commands` item
//      schema was an independent duplicate.
//   2. STATIC — zero readers outside `packages/spec`'s own test and generated
//      artifacts, in objectstack, objectui (at the pinned sha) and cloud
//      (controls: `OclifPluginConfigSchema` and `@objectstack/spec` both
//      resolve hits — the scans see real readers).
//   3. DOORS — no metadata-type binding, no stack collection, no manifest
//      embed: no authored document could ever carry it.
//
// Route 3: with no carrier key there is nothing to tombstone and no seam for
// a D2 conversion — `RETIRED_DEFS_BY_MAJOR[18]` plus the D3 semantic entry
// `cli-command-contribution-retired` ARE the declaration.
//
// Form follows #11825 / #8715 / #4988: resolved symbol identity over every
// public entry via the build-time `export-origins/` artifact.
describe('[#12007] kernel/ CLICommandContribution retirement', () => {
  /** The 2 names the retired def exported (1 schema const + 1 type). */
  const RETIRED_NAMES = [
    'CLICommandContributionSchema',
    'CLICommandContribution',
  ] as const;

  /**
   * Names that must SURVIVE on `./kernel`: the LIVE half of the same module —
   * `OclifPluginConfigSchema` describes the `oclif` section of a plugin's own
   * `package.json`, the mechanism that actually registers CLI commands.
   * Exactly what a too-wide "tidy the cli-extension module" sweep would take
   * (full-file deletion was explicitly NOT the shape: the module docblock's
   * Commander.js migration prose is cited by the `contributes.commands`
   * tombstone).
   */
  const MUST_SURVIVE_KERNEL = [
    'OclifPluginConfigSchema',
    'OclifPluginConfig',
  ] as const;

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
      expect(holdersOf(name), `${name} must have zero holders after #12007`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    const kernelNames = exportNamesOf('./kernel');
    for (const name of MUST_SURVIVE_KERNEL) {
      expect(kernelNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the runtime barrel resolves without the retired schema and keeps the survivor', async () => {
    const kernel = await import('./index');
    expect(kernel, 'CLICommandContributionSchema must not be exported after #12007')
      .not.toHaveProperty('CLICommandContributionSchema');
    // Anti-vacuity: the barrel really resolved and still exports the live
    // oclif surface plus an unrelated kernel anchor.
    expect(kernel).toHaveProperty('OclifPluginConfigSchema');
    expect(kernel).toHaveProperty('ManifestSchema');
  });
});
