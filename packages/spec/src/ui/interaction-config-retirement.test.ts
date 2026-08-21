// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
// ─── [#4988] the five ui/ interaction config modules are RETIRED ────────────
//
// ADR-0049 enforce-or-remove, maintainer ruling 2026-08-04: `ui/touch.zod.ts`,
// `ui/dnd.zod.ts`, `ui/keyboard.zod.ts`, `ui/animation.zod.ts` and
// `ui/offline.zod.ts` (22 `z.object` sites, 32 emitted defs, 64 exported names)
// are deleted whole, reference docs with them.
//
// The measurement that decided it, re-run on `origin/main` before the removal,
// with its controls passing in the SAME run:
//
//   1. STATIC — no module under `packages/spec/src` imported any of the five
//      except the `ui/index.ts` barrel, so no schema declared a carrier key and
//      no author could write a path that reached these shapes.
//   2. GRAPH — a BFS from all 24 metadata-type roots plus `defineStack`'s
//      `ObjectStackSchema` (25 roots, 4742 nodes) reached NONE of the 21 named
//      object shapes, while `PageSchema` / `WebhookSchema` / `StateMachineSchema`
//      all resolved `direct`. Injecting a synthetic carrier flipped all 21 to
//      `direct` — so "unreachable" was a fact about the graph, not a broken
//      walker (`door-reachability.testkit.ts`).
//   3. CALL SITES — zero `.parse()` / `.safeParse()` on any of them in
//      objectstack / objectui / cloud outside their own unit tests.
//
// Business reading, which is what the ruling turned on: these five categories
// are RENDERER BUILT-IN BEHAVIOR, not per-page author metadata. Offline is a
// platform capability whose vocabulary belongs on a future sync engine.
//
// ## Why route 3, and why there is nothing to tombstone
//
// The retirement playbook's route table forks on what parses the key. Here
// NOTHING did: with no carrier key there is no shape on which a `retiredKey()`
// tombstone could sit and no author document for an ADR-0087 D2 conversion to
// rewrite. That is route 3 ("nothing parses it → neither"), the shape #4834 /
// PR #4878 used for the kernel plugin-runtime family and PR #5293 for
// `HttpServerConfig`. The migration channel is the D3 `SemanticMigration`
// `ui-interaction-config-family-retired` plus `api-surface.json`.
//
// ## This pin is BIDIRECTIONAL and both halves carry weight
//
// Absence alone is satisfiable by deleting far too much — a sweep that took
// `ui/i18n.zod.ts` or `ui/responsive.zod.ts` with it would pass every
// `not.toContain` below. The SURVIVAL half is what catches that, and it is not
// hypothetical: `ui/responsive.zod.ts` was the sixth file of the same #4001
// batch 13 and measured REACHABLE (`page.components[].responsive`), so it was
// tightened rather than retired. It must still be here.
//
// Form follows #4834 / PR #5300: resolved symbol identity over every public
// entry in `package.json`'s exports map. #4642 established that a compile-time
// conditional-type pin in this package was a no-op until #5286 (tsconfig excluded
// `**/*.test.ts`; vitest never enables `typecheck`), so the compiler-API walk
// with anti-vacuity guards is the load-bearing instrument.
describe('[#4988] ui/ interaction config family retirement', () => {
  /** Every name the five modules exported (32 schema/enum consts + 32 types). */
  const RETIRED_NAMES = [
    // touch.zod.ts
    'TouchTargetConfig', 'TouchTargetConfigSchema',
    'GestureType', 'GestureTypeSchema',
    'SwipeDirection', 'SwipeDirectionSchema',
    'SwipeGestureConfig', 'SwipeGestureConfigSchema',
    'PinchGestureConfig', 'PinchGestureConfigSchema',
    'LongPressGestureConfig', 'LongPressGestureConfigSchema',
    'GestureConfig', 'GestureConfigSchema',
    'TouchInteraction', 'TouchInteractionSchema',
    // animation.zod.ts — NOTE: distinct from the theme `animation` block #5021
    // retired; different file, different defs, different manifest entries.
    'TransitionPreset', 'TransitionPresetSchema',
    'EasingFunction', 'EasingFunctionSchema',
    'TransitionConfig', 'TransitionConfigSchema',
    'AnimationTrigger', 'AnimationTriggerSchema',
    'ComponentAnimation', 'ComponentAnimationSchema',
    'PageTransition', 'PageTransitionSchema',
    'MotionConfig', 'MotionConfigSchema',
    // dnd.zod.ts
    'DragHandle', 'DragHandleSchema',
    'DropEffect', 'DropEffectSchema',
    'DragConstraint', 'DragConstraintSchema',
    'DropZone', 'DropZoneSchema',
    'DragItem', 'DragItemSchema',
    'DndConfig', 'DndConfigSchema',
    // keyboard.zod.ts
    'FocusTrapConfig', 'FocusTrapConfigSchema',
    'KeyboardShortcut', 'KeyboardShortcutSchema',
    'FocusManagement', 'FocusManagementSchema',
    'KeyboardNavigationConfig', 'KeyboardNavigationConfigSchema',
    // offline.zod.ts
    'OfflineStrategy', 'OfflineStrategySchema',
    'ConflictResolution', 'ConflictResolutionSchema',
    'SyncConfig', 'SyncConfigSchema',
    'PersistStorage', 'PersistStorageSchema',
    'EvictionPolicy', 'EvictionPolicySchema',
    'OfflineCacheConfig', 'OfflineCacheConfigSchema',
    'OfflineConfig', 'OfflineConfigSchema',
  ] as const;

  /**
   * Names that must SURVIVE on `./ui`, one per neighbouring concern a
   * too-wide sweep would plausibly take:
   *
   * - `ResponsiveConfigSchema` — batch 13's sixth file, measured REACHABLE and
   *   tightened instead of retired. The single most likely over-deletion.
   * - `AriaPropsSchema` / `I18nLabelSchema` — the two shapes the five retired
   *   modules imported; deleting a consumer must not take its dependency.
   * - `NotificationTypeSchema` — `ui/notification.zod.ts` kept its presentation
   *   enums when PR #5300 retired `NotificationActionSchema` out of it.
   * - `SharingConfigSchema` — `ui/sharing.zod.ts`'s live door.
   * - (`ThemeSchema` stood here until #10485 retired the theme surface whole,
   *   ADR-0049 — a survivor list entry follows its subject out.)
   * - `PageSchema` / `PageComponentSchema` — the authoring roots the five
   *   vocabularies would have hung off had they ever had a carrier.
   */
  const MUST_SURVIVE = [
    'ResponsiveConfigSchema',
    'AriaPropsSchema',
    'I18nLabelSchema',
    'NotificationTypeSchema',
    'SharingConfigSchema',
    'PageSchema',
    'PageComponentSchema',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the survivors still stand on ./ui', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796. `holdersOf` is now the baseline's query, and
    // `export-origins.test.ts` pins that it discriminates.)
    for (const needed of ['.', './ui', './automation', './integration', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // Anti-vacuity: `./ui` is a large, real surface — so `not.toContain` on it
    // means something.
    expect(exportNamesOf('./ui').length, './ui must export a non-trivial surface').toBeGreaterThan(100);

    // ── ABSENCE (every entry, not just ./ui) ──────────────────────────────
    for (const name of RETIRED_NAMES) {
      const holders = holdersOf(name);
      expect(holders, `${name} must have zero holders after #4988`).toEqual([]);
    }

    // ── SURVIVAL (on ./ui, where they live) ───────────────────────────────
    const uiNames = exportNamesOf('./ui');
    for (const name of MUST_SURVIVE) {
      expect(uiNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the five modules are gone from disk, and nothing imports them any more', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const RETIRED_MODULES = ['touch', 'dnd', 'keyboard', 'animation', 'offline'] as const;
    for (const m of RETIRED_MODULES) {
      expect(fs.existsSync(path.join(srcRoot, 'ui', `${m}.zod.ts`)), `ui/${m}.zod.ts must be deleted`).toBe(false);
    }
    // Anti-vacuity for the existence probe: the sibling that was MEASURED
    // reachable and kept must still be on disk, so "false" above cannot mean
    // "this test is looking in the wrong directory".
    expect(fs.existsSync(path.join(srcRoot, 'ui', 'responsive.zod.ts'))).toBe(true);

    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf-8');
          for (const m of RETIRED_MODULES) {
            if (new RegExp(`(?:import|export)[^;]*['"][^'"]*/${m}\\.zod['"]`).test(src)) {
              importers.push(`${path.relative(srcRoot, full)} → ${m}.zod`);
            }
          }
        }
      }
    };
    walk(srcRoot);
    expect(importers, 'a resurrected import means the retirement is being undone — re-read #4988').toEqual([]);
  });

  it('runtime namespace agrees with the compiler view', async () => {
    const ui = await import('./index');
    for (const name of RETIRED_NAMES) {
      expect(name in ui, `ui must not export ${name}`).toBe(false);
    }
    // Survival at runtime too — the const half of MUST_SURVIVE.
    for (const name of MUST_SURVIVE) {
      expect(name in ui, `${name} must SURVIVE at runtime`).toBe(true);
    }
  });

  it('the bare `ConflictResolution` name is now published by NOBODY — #4738 left it to ./ui alone', async () => {
    // #4738 renamed the connector-side enum to `ConnectorConflictResolution`
    // BECAUSE `ui/offline.zod.ts` owned the bare name. That owner is gone, so
    // the bare name is unowned rather than re-homed: the rename is not undone
    // (`ConnectorConflictResolution` is the connector vocabulary's real name
    // now, and un-renaming it would be a second breaking change to hand a
    // freed word back), and no other domain may quietly adopt it.
    const ui = await import('./index');
    const integration = await import('../integration/index');
    const automation = await import('../automation/index');
    for (const ns of [ui, integration, automation]) {
      expect('ConflictResolution' in ns).toBe(false);
      expect('ConflictResolutionSchema' in ns).toBe(false);
    }
    // The connector vocabulary itself is untouched, byte for byte.
    expect('ConnectorConflictResolutionSchema' in integration).toBe(true);
    expect(() => integration.ConnectorConflictResolutionSchema.parse('target_wins')).not.toThrow();
    // And the FOURTH relative — `./api`'s route-merge policy — keeps its own
    // distinct name and is unaffected by any of this.
    const api = await import('../api/index');
    expect('ConflictResolutionStrategy' in api).toBe(true);
  });
});
