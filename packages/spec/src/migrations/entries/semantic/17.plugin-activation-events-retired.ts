// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'plugin-activation-events-retired',
  surface:
    'kernel.dynamicLoadRequest.activationEvents / studio.studioPluginManifest.activationEvents',
  replacement:
    '(removed — delete the key. Every plugin activates immediately on load/registration, '
    + 'which is the only behaviour that has ever existed; `activate()` still runs at '
    + 'registration time. Lazy activation, if built, returns via the enforce route of '
    + 'ADR-0049 through a new ADR, with a vocabulary its executor actually honours)',
  reason:
    'Both `activationEvents` keys — and the `ActivationEventSchema` trigger vocabulary '
    + 'they embedded (`onCommand` / `onRoute` / … / `onView` after the #4653 convergence) — '
    + 'promised lazy plugin activation ("plugins remain dormant until an activation event '
    + 'fires") that no runtime in objectstack, cloud, cloud-v1 or objectui ever '
    + "implemented: nothing anywhere read the key, every plugin activates immediately, and "
    + "cloud-v1's own ROADMAP recorded lazy activation as unimplemented (planned v0.4.0). "
    + 'That is the ADR-0049 false-compliance shape in the semantically-lying direction: an '
    + 'author writing `activationEvents: [{ type: \'onMetadataType\', pattern: \'flow\' }]` '
    + 'expected deferral and got eager activation with a clean parse. Neither parent shape '
    + 'is stored metadata — `StudioPluginManifest` is TS configuration parsed by '
    + '`defineStudioPlugin` (a root schema, never part of a stack tree) and '
    + '`DynamicLoadRequest` is a runtime request shape with no caller — so no '
    + '`sys_metadata` row can carry the key and there is no source for the D2 chain to '
    + 'rewrite; this entry is the D3 record. The kernel key is tombstoned via '
    + '`retiredKey()` (its schema is not `.strict()`; a plain delete would strip an '
    + "authored value silently), the studio key is rejected by the strict manifest parse "
    + 'with a guidance prescription (as are its former VS Code-flavoured aliases '
    + '`activation` / `events` / `onActivate`), and the orphaned `ActivationEventSchema` / '
    + '`ActivationEvent` exports are removed from `./kernel` and `./studio` with the keys '
    + '(#3950: an exported schema with no consumer is read as a capability). #4657. '
    + 'SUPERSEDED ON THE KERNEL SIDE by #4834 (same unreleased major): the whole '
    + '`DynamicLoadRequest` shape — and the rest of the plugin-runtime family with it — '
    + 'was removed, which took this key\'s `retiredKey()` tombstone with it. That is '
    + 'strictly stronger than the tombstone, not weaker: there is no longer a '
    + '`DynamicLoadRequest` to author the key INTO, so the prescription an author needs '
    + 'is no longer "delete this key" but "this request shape does not exist" (see '
    + '`plugin-runtime-family-retired`). The studio half of this entry is '
    + 'unaffected and still enforced by the strict manifest parse.',
  acceptanceCriteria:
    'No `defineStudioPlugin` input authors `activationEvents` — authoring it is an '
    + 'unknown key on the strict studio manifest and a parse error carrying the '
    + 'prescription. On the kernel side the stronger #4834 criterion applies instead: '
    + 'there is no `DynamicLoadRequest` type or schema left to author it into at all. No '
    + 'code imports `ActivationEventSchema` / `ActivationEvent` from '
    + '`@objectstack/spec/kernel` or `@objectstack/spec/studio` (TS2305 after upgrade). '
    + 'Runtime behaviour is byte-identical: plugins loaded eagerly before and after.',
};
