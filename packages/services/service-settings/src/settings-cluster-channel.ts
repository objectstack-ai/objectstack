// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SpecifierScope } from '@objectstack/spec/system';

/**
 * Cluster channel for settings writes: the settings service's adopter of the
 * cluster-invalidation family `metadata.mutated` established (the fifth lane
 * of `MetadataClusterBridgePlugin` in `@objectstack/service-cluster`).
 *
 * `settings:changed` is an in-process subscriber set. Its subscribers rebuild
 * the auth posture, the password / session / MFA policy, the organization
 * access policy, mail, SMS, storage and the AI provider from the settings
 * store. Without this channel only the replica that took the write rebuilt;
 * every peer kept the old configuration, security posture included, until it
 * restarted.
 *
 * Published by the {@link SettingsService} that performed a write (see
 * `SettingsService.attachSettingsChangePubSub`) and consumed by every peer,
 * which emits its own local `settings:changed` so each subscriber re-reads the
 * shared store. Distinct from the local event name on purpose: that name is
 * the in-process bus, this one is the wire.
 */
export const SETTINGS_CHANGE_CLUSTER_CHANNEL = 'settings.changed';

/**
 * Payload for {@link SETTINGS_CHANGE_CLUSTER_CHANNEL}.
 *
 * ⭐ A SIGNAL, never content: only the ADDRESS of the change rides the
 * channel (namespace, key, scope, action, time), the same fields the local
 * `settings:changed` event carries. ⛔ Never a value, a ciphertext handle or a
 * secret. The shared store stays the single source of truth: a receiver's
 * subscribers re-read it, so a duplicate or re-ordered delivery converges to
 * the same configuration as a single one.
 */
export interface ClusterSettingsChangePayload {
  /** Origin nodeId, used for loopback suppression. */
  originNode?: string;
  /** Namespace whose value changed. */
  namespace: string;
  /** Specifier key that changed. */
  key: string;
  /** Scope of the row that was written. */
  scope: SpecifierScope;
  /** `'set'` when a value was written, `'reset'` when the row was cleared. */
  action: 'set' | 'reset';
  /** ISO 8601 time the write completed on the origin node. */
  at: string;
}
