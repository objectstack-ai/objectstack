// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
// ─── [#4657] `ActivationEventSchema` / `ActivationEvent` are REMOVED ─────────
//
// ADR-0049 enforce-or-remove, ruled REMOVE: the activation-event vocabulary
// declared lazy plugin activation ("plugins remain dormant until an activation
// event fires") that NO runtime in objectstack / cloud / cloud-v1 / objectui
// ever implemented — every plugin activates immediately on load/registration,
// and cloud-v1's ROADMAP recorded the capability as unimplemented. Both keys
// that embedded the schema are retired in this change
// (`DynamicLoadRequest.activationEvents` → retiredKey() tombstone;
// `StudioPluginManifest.activationEvents` → strict-parse guidance rejection),
// which left the def an orphaned value schema: an exported schema with no
// consumer is read as a capability by whoever finds it (#3950), so the
// declaration and both its entry-point exports (`./kernel`, and the `./studio`
// re-export #4653 had just added) are deleted.
//
// Why a compiler-API pin rather than a type-level one: #4642 established that
// a compile-time conditional-type pin in this package was a no-op until #5286 (tsconfig
// excluded `**/*.test.ts`; vitest never enables `typecheck`), so the
// load-bearing pin is the program below, with anti-vacuity guards — the
// #4737 `ActionLocation` retirement's machinery, pointed at absence instead of
// ownership. Sabotage-verified in the PR: resurrecting the declaration in
// `./kernel` turns it red, re-exporting ANY schema under the bare name from
// `./studio` turns it red, and pointing the enumeration at nothing trips the
// anti-vacuity guards rather than passing silently.
//
// (#4834 superseded the kernel half: `DynamicLoadRequest` — the shape that
// carried the tombstoned key — was removed whole, so this file's kernel-side
// parse assertion is gone. See the block above the studio test.)
describe('[#4657] ActivationEventSchema removal — no entry exports the name', () => {
  it('resolves the export surface: the retired names have ZERO holders across every public entry', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796. `holdersOf` is now the baseline's query, and
    // `export-origins.test.ts` pins that it discriminates.)
    for (const needed of ['./kernel', './studio']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // 1. Anti-vacuity on the two surfaces that carried the names: both still
    //    export a non-trivial surface (so "does not contain" cannot pass by
    //    resolving nothing), and the SURVIVING neighbours stand — the parents
    //    whose keys were retired most of all.
    const kernelNames = exportNamesOf('./kernel');
    const studioNames = exportNamesOf('./studio');
    expect(kernelNames.length, './kernel must export a non-trivial surface').toBeGreaterThan(40);
    expect(studioNames.length, './studio must export a non-trivial surface').toBeGreaterThan(40);
    // (The kernel anchors used to be `DynamicLoadRequestSchema` /
    // `PluginSourceSchema` — the parents of the retired key. #4834 removed that
    // whole family, so the anchors move to surviving kernel neighbours; the
    // assertion they serve is unchanged.)
    expect(kernelNames).toContain('PluginSchema');
    expect(kernelNames).toContain('PluginContextSchema');
    expect(studioNames).toContain('StudioPluginManifestSchema');
    expect(studioNames).toContain('StudioPluginContributionsSchema');

    // 2. The removal itself: NO public entry exports either retired name — not
    //    the old owners, and not any other entry that might "helpfully" adopt
    //    them. A re-export of anything under the bare name would tell authors
    //    the platform has an activation vocabulary again (the C14/C15 lesson:
    //    a re-export can lie about the domain even when the symbol is honest).
    for (const retired of ['ActivationEventSchema', 'ActivationEvent']) {
      expect(holdersOf(retired), `${retired} must have zero holders`).toEqual([]);
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const kernel = await import('./index');
    const studio = await import('../studio/index');

    for (const [label, ns] of [['./kernel', kernel], ['./studio', studio]] as const) {
      expect('ActivationEventSchema' in ns, `${label} must not export ActivationEventSchema`).toBe(false);
    }
    // Anti-vacuity: the namespaces just probed are real and non-trivial.
    expect('PluginSchema' in kernel).toBe(true);
    expect('StudioPluginManifestSchema' in studio).toBe(true);
  });

  // ─── The kernel half of #4657 is SUPERSEDED by #4834 ───────────────────────
  //
  // `DynamicLoadRequest.activationEvents` was tombstoned here with a
  // `retiredKey()` prescription. #4834 removed the ENTIRE `DynamicLoadRequest`
  // family (ADR-0049 enforce-or-remove on the whole "Dynamic Loading"
  // capability, four-repo zero-consumer), which took the tombstone with it —
  // legitimately: "the whole request shape is gone" is strictly stronger than
  // "this one key is gone", and there is no longer a parse for a prescription
  // to be delivered at. What replaces it as the kernel-side pin is
  // `plugin-runtime-retirement.test.ts` (zero holders for all five names),
  // plus the zero-holder assertion above, which covers `ActivationEventSchema`
  // itself on both entries. Only the studio half still has a live parse:
  it('the studio manifest still parses — and rejects the retired key with its prescription', async () => {
    const { StudioPluginManifestSchema } = await import('../studio/plugin.zod');

    // Strict parse + guidance — the SAME document differing only in this one
    // key stays legal without it (so the negative cannot pass for an unrelated
    // reason).
    const manifest = { id: 'objectstack.my-plugin', name: 'My Plugin' };
    expect(StudioPluginManifestSchema.parse(manifest)).not.toHaveProperty('activationEvents');
    expect(() =>
      StudioPluginManifestSchema.parse({
        ...manifest,
        activationEvents: [{ type: 'onStartup', pattern: '*' }],
      }),
    ).toThrow(/activationEvents.*removed.*#4657/s);
  });
});
