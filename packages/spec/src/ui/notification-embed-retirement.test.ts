// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
// ─── [#5015] `NotificationActionSchema` + `EmbedConfigSchema` are REMOVED ────
//
// ADR-0049 enforce-or-remove, ruled REMOVE on 2026-08-04. Both shapes were
// published vocabulary with **no authoring door**: no schema anywhere declared a
// carrier key for either, neither was reachable by a BFS from the 24
// metadata-type roots plus `defineStack`'s `ObjectStackSchema`, and no
// `.parse()` on either existed in objectstack, cloud or objectui outside their
// own unit tests. #4001 批 14 measured that and deliberately did NOT tighten
// them — closing a shape nothing parses only buys *"a precisely-validated dead
// slot, the more convincing lie"* (#4583) — and filed the disposition as #5015.
// This is that disposition, executed.
//
// The two arrived at orphanhood by the same route, one level apart:
//   - `NotificationAction` lost its wrappers at #4610 (`NotificationSchema` /
//     `NotificationConfigSchema`, the #4535 C3 dual-source cleanup — its "zero
//     consumers" evidence was later falsified for objectui and is corrected on
//     `notification.zod`'s tombstone; the removal itself stands, #5781);
//   - `EmbedConfig` lost its key at 17.0.0 (`App.embed`, retired by the 2026-06
//     liveness audit and still standing as a `retiredKey()` tombstone in
//     `app.zod.ts` — the value shape simply outlived the key).
// An exported schema with no consumer is read as a capability (#3950), so the
// value shapes follow the keys.
//
// ⚠️ SCOPE: this is a per-SCHEMA retirement, not a per-file one. Both modules
// SURVIVE and keep live exports — `notification.zod` its three presentation
// enums, `sharing.zod` the live `SharingConfigSchema` door that
// `FormViewSchema.sharing` carries and `rest-server.ts` gates the anonymous form
// routes on. The survival assertions below are as load-bearing as the absence
// ones: a retirement that took `SharingConfigSchema` with it would break public
// form sharing, and "the names are gone" alone cannot tell the two apart.
//
// Why THIS pin and not a type-level one: #4642 established that a compile-time
// conditional-type assertion in this package was a no-op until #5286 (the package tsconfig
// excluded `**/*.test.ts`, and vitest never enables `typecheck`), so an
// `Assert< Equal< … > >` here was decoration until #5286. The load-bearing pin is the
// TypeScript compiler-API program below, which resolves the REAL export surface
// of every public entry from `package.json`'s exports map and asserts each
// retired name has zero holders — by symbol identity, not by grepping text.
//
// Every `not`-shaped assertion carries an anti-vacuity guard, because the
// failure mode of an absence pin is passing for the wrong reason (a path typo,
// an entry that stops resolving, an empty enumeration).
describe('[#5015] NotificationAction / EmbedConfig removal — no entry exports either name', () => {
  /** The two schema names + the type aliases they published. */
  const RETIRED = [
    'NotificationActionSchema',
    'NotificationAction',
    'EmbedConfigSchema',
    'EmbedConfig',
  ] as const;

  /**
   * Live neighbours that must SURVIVE — three from `notification.zod` (the
   * presentation vocabulary objectui's toaster reads) and the live sharing door
   * beside the shape that was removed. These do double duty: they prove the
   * probe finds names when names are there, and they pin the scope of the
   * retirement to the two shapes it was ruled over.
   */
  const SURVIVES = [
    'NotificationTypeSchema',
    'NotificationSeveritySchema',
    'NotificationPositionSchema',
    'SharingConfigSchema',
  ] as const;

  it('resolves the export surface: the retired names have ZERO holders across every public entry', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796. `holdersOf` is now the baseline's query, and
    // `export-origins.test.ts` pins that it discriminates.)
    for (const needed of ['.', './ui']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // Anti-vacuity (3): `holdersOf` really finds holders when a name IS
    // exported — proven on the surviving neighbours in the very same modules, so
    // `[]` below means "absent", not "the probe is broken". This is the guard
    // that distinguishes a correct retirement from a deleted `ui` barrel.
    for (const name of SURVIVES) {
      expect(holdersOf(name), `${name} must SURVIVE this retirement`).toContain('./ui');
    }
    const uiNames = exportNamesOf('./ui');
    expect(uiNames.length, './ui must still export a non-trivial surface').toBeGreaterThan(40);

    // The removal itself: NO public entry exports either name — not the old
    // owner, and not some other entry that might "helpfully" adopt them (a
    // re-export can lie about the domain even when the symbol is honest).
    // Exact equality with `[]`, so a partial move cannot slip through.
    for (const name of RETIRED) {
      expect(holdersOf(name), `${name} must have zero holders`).toEqual([]);
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const ui = await import('./index');
    const root = await import('../index');

    // Absence, at both entries. `./ui` is the load-bearing one — it is where
    // both shapes actually lived. The root barrel is checked too, so that no
    // future edit "helpfully" adopts a retired name there.
    for (const [label, ns] of [['./ui', ui], ['.', root]] as const) {
      for (const name of RETIRED) {
        expect(name in ns, `${label} must not export ${name}`).toBe(false);
      }
    }

    // Survival is asserted ONLY on `./ui`, and the asymmetry is deliberate:
    // the root barrel is a CURATED surface that re-exports just the `defineX`
    // factories from `./ui`, never the schema vocabulary. So the four survivors
    // were never on `.` and neither were the two retired names — which means
    // the root's absence check above is weak evidence on its own, and asserting
    // survival there would be asserting something that was never true. (Written
    // this way after the first draft asserted survival on both entries and this
    // suite went red on `. must still export NotificationTypeSchema` — the
    // anti-vacuity guard catching its own author.)
    for (const name of SURVIVES) {
      expect(name in ui, `./ui must still export ${name}`).toBe(true);
    }
    expect(Object.keys(ui).length).toBeGreaterThan(40);
  });

  it('the modules SURVIVE — this is a per-schema retirement, not a per-file one', async () => {
    // The #4834 precedent removed a whole module and pinned that the path no
    // longer imports. Here the opposite is the correct assertion: both modules
    // must still load, because each still owns live exports. Deleting either
    // file would satisfy every absence assertion above while destroying working
    // surface — `SharingConfigSchema` most of all.
    const notification = await import('./notification.zod');
    const sharing = await import('./sharing.zod');

    expect(Object.keys(notification)).toEqual(
      expect.arrayContaining([
        'NotificationTypeSchema',
        'NotificationSeveritySchema',
        'NotificationPositionSchema',
      ]),
    );
    expect(Object.keys(notification)).not.toContain('NotificationActionSchema');
    expect(Object.keys(sharing)).toContain('SharingConfigSchema');
    expect(Object.keys(sharing)).not.toContain('EmbedConfigSchema');

    // And the surviving door still WORKS — behaviour, not just presence. Its
    // 批 14 strictness is asserted in `strictness-batch14.test.ts`; this is the
    // narrower claim that the retirement did not hollow it out.
    const parsed = sharing.SharingConfigSchema.parse({ enabled: true, allowAnonymous: true });
    expect(parsed.allowAnonymous).toBe(true);
  });
});
