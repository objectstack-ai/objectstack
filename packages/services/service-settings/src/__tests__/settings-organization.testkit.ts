// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: how a suite that binds its own engine states the
 * composition's organization facts (#25249, ADR-0131 D9).
 *
 * A host that states no organization source has the service ask D9 itself,
 * through the engine it holds — and an engine with no registry to ask is read
 * the fail-closed way, as one that DOES register `sys_organization`. So a
 * suite states it, one of two ways:
 *
 *  - {@link LEAN_ORGANIZATION_SOURCE}, at the bind site, for a double: this
 *    composition registers no organization object.
 *  - {@link withEngineRegistry}, for a suite that runs the real ObjectQL behind
 *    the production adapter: the real registry answers, as it would through
 *    the raw engine the plugin hands D9.
 */

import type { SettingsOrganizationSource } from '../settings-service.js';
import type { SettingsEngine } from '../settings-service.types.js';

/** A lean composition's answer: no organization object is registered. */
export const LEAN_ORGANIZATION_SOURCE: SettingsOrganizationSource = async () => ({ kind: 'no-organization-object' });

/** `wrapped`, carrying the real engine's registry, so D9's registry question reaches it. */
export function withEngineRegistry<E extends SettingsEngine>(wrapped: E, engine: { registry: unknown }): E & { registry: unknown } {
  return Object.assign(wrapped, { registry: engine.registry });
}
