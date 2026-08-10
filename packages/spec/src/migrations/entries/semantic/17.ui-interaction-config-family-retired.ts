// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-interaction-config-family-retired',
  surface:
    'ui.touchInteraction / ui.gestureConfig / ui.dndConfig / ui.keyboardNavigationConfig '
    + '/ ui.componentAnimation / ui.motionConfig / ui.pageTransition / ui.offlineConfig '
    + '(the whole export surface of ui/touch.zod.ts, ui/dnd.zod.ts, ui/keyboard.zod.ts, '
    + 'ui/animation.zod.ts and ui/offline.zod.ts — 32 defs, 64 exported names)',
  replacement:
    '(removed — there is no replacement key, because there was never a key. Touch targets, '
    + 'drag-and-drop, focus management, keyboard shortcuts and motion are RENDERER BUILT-IN '
    + 'behaviour: the component library decides them, not a per-page metadata author. '
    + 'Offline is a platform capability, and its vocabulary belongs on the sync engine that '
    + 'owns the queue, the conflict policy and the cache — none of which exists yet. Delete '
    + 'the import and the value. Whichever of these earns real product pull returns WITH its '
    + 'own vocabulary and its executor, the #4910 way, not by un-retiring a declaration)',
  reason:
    'Five `@objectstack/spec/ui` modules declared a full interaction-configuration '
    + 'vocabulary — 22 `z.object` sites across touch/gesture, drag-and-drop, '
    + 'focus/keyboard, animation/motion and offline/sync — and NOTHING in the protocol '
    + 'carried them. This is the ADR-0049 false-compliance shape in its most inviting form '
    + 'for an AI author (ADR-0033), and worse than the ordinary declared-but-unread defect: '
    + '`authorable-surface.json` listed 109 keys under these defs and '
    + '`content/docs/references/ui/{touch,dnd,keyboard,animation,offline}.mdx` rendered them '
    + 'as authoring tables, so the published documentation advertised a vocabulary with no '
    + 'carrier key anywhere. An author following `dnd.mdx` and writing a `dnd:` block onto a '
    + 'page component was rejected by `PageComponentSchema` for an unrecognized key — the '
    + 'docs and the schema disagreeing about the platform (Prime Directive #10). Three '
    + 'independent measurements, each with its controls passing in the same run: (1) no '
    + 'module under `packages/spec/src` imported any of the five except the `ui/index.ts` '
    + 'barrel, so no schema declared a carrier key; (2) a BFS over the in-memory Zod graph '
    + 'from all 24 metadata-type roots plus `defineStack`\'s `ObjectStackSchema` (25 roots, '
    + '4742 nodes) reached none of the 21 named object shapes, while `PageSchema`, '
    + '`WebhookSchema` and `StateMachineSchema` all resolved `direct` and a synthetic '
    + 'carrier flipped all 21 — so unreachability was a fact about the graph, not a broken '
    + 'walker; (3) zero `.parse()` / `.safeParse()` in objectstack, objectui or cloud '
    + 'outside these modules\' own unit tests. objectui holds TYPE re-exports and parity '
    + 'ratchets, never validators, and says so (#2561). The 2026-08-04 ruling weighed '
    + 'wiring a carrier key (option B) and rejected it: that is a feature with a renderer '
    + 'behind it, not ledger clean-up. It also weighed tightening the shapes to '
    + '`strictObject` and rejected that explicitly — strictness is a property of a PARSE and '
    + 'there is no parse, so it would spend a breaking change to leave "a precisely '
    + 'validated dead slot, the more convincing lie" (#4583). Because there was no carrier '
    + 'key there is nothing to tombstone and no `sys_metadata` row or source file for a D2 '
    + 'conversion to rewrite: this entry is the D3 record, the same route 3 as #4834 (kernel '
    + 'plugin-runtime family) and #4938 (`HttpServerConfig`). ⚠️ Not to be confused with '
    + '#5021, which retired the THEME `animation` block — a different file, different defs, '
    + 'and that one did have a carrier key and therefore a tombstone. ADR-0049, #4988.',
  acceptanceCriteria:
    'No code imports any of the 64 retired names from `@objectstack/spec` or '
    + '`@objectstack/spec/ui` — `TouchTargetConfig(Schema)`, `GestureType(Schema)`, '
    + '`SwipeDirection(Schema)`, `SwipeGestureConfig(Schema)`, `PinchGestureConfig(Schema)`, '
    + '`LongPressGestureConfig(Schema)`, `GestureConfig(Schema)`, `TouchInteraction(Schema)`, '
    + '`TransitionPreset(Schema)`, `EasingFunction(Schema)`, `TransitionConfig(Schema)`, '
    + '`AnimationTrigger(Schema)`, `ComponentAnimation(Schema)`, `PageTransition(Schema)`, '
    + '`MotionConfig(Schema)`, `DragHandle(Schema)`, `DropEffect(Schema)`, '
    + '`DragConstraint(Schema)`, `DropZone(Schema)`, `DragItem(Schema)`, `DndConfig(Schema)`, '
    + '`FocusTrapConfig(Schema)`, `KeyboardShortcut(Schema)`, `FocusManagement(Schema)`, '
    + '`KeyboardNavigationConfig(Schema)`, `OfflineStrategy(Schema)`, '
    + '`ConflictResolution(Schema)`, `SyncConfig(Schema)`, `PersistStorage(Schema)`, '
    + '`EvictionPolicy(Schema)`, `OfflineCacheConfig(Schema)`, `OfflineConfig(Schema)` — '
    + 'every one is TS2305 after upgrade, on every public entry (pinned by resolved symbol '
    + 'identity in `ui/interaction-config-retirement.test.ts`). No metadata document needs '
    + 'editing, because none could ever carry one of these blocks: a stack that parsed '
    + 'before parses byte-for-byte the same after. If you consumed the bare '
    + '`ConflictResolution` from `@objectstack/spec/ui` as a TYPE for your own offline code, '
    + 'declare that union locally — it is your client\'s policy, not the platform\'s. '
    + '`@objectstack/spec/integration`\'s `ConnectorConflictResolution` (connector sync) and '
    + '`@objectstack/spec/api`\'s `ConflictResolutionStrategy` (route merge policy) are '
    + 'different concepts and are untouched.',
};
