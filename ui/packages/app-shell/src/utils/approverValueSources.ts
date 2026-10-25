/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * approverValueSources — the approver value bindings as the SERVER publishes
 * them, read the same way by both approval readers: the flow designer's
 * approver value picker (`FlowReferenceField`) and the console's approver
 * labels (`approverIdentity` / `useApproverDirectory`).
 *
 * ## The registry arm (objectui#7611 Q3b, ruled objectstack#22865 Q3b → B)
 *
 * The spec's `ApproverValueBinding` is a union, and its projection
 * `APPROVER_VALUE_SOURCES` is what reaches a renderer. Its `data` member names a
 * ROW of a directory object (`user` / `team` / `department`). objectstack#22710
 * added a `registry` member, `{ source: 'registry', type }`: the value is the
 * machine NAME of an item of metadata `type`, its candidates are listed by
 * `GET /api/v1/meta/<type>`, and a picker commits the item's `name` — a catalog
 * item has no row id (ADR-0131 D4). `position` is bound that way.
 *
 * Before objectui moved to `@objectstack/spec` 18 (objectui#12030), its
 * installed spec predated that member while two consoles already received it —
 * one bundled with the server's own spec injected (`OBJECTSTACK_SPEC_DIST`), and
 * one talking to such a server, whose approval node schema publishes the same
 * projection as `xRef.sources`. Both readers then kept only the `data` member
 * and dropped the rest, so a position approver lost its designer picker and its
 * readable label.
 *
 * Nothing here says which kinds are registry-backed: every answer is read off
 * the published binding, so a kind the spec moves is followed with no edit
 * here, and the `data` member is read exactly as before.
 *
 * The installed spec declares the registry member itself since 18, so this
 * module reads `APPROVER_VALUE_SOURCES` directly; the widened type it carried
 * through 17.x is gone (objectui#12030). This module only READS what the
 * server publishes; no authoring surface is touched, so `objectui validate`
 * and the strict faces are unchanged.
 */

import { APPROVER_VALUE_SOURCES } from '@objectstack/spec/automation';

/** One entry of `APPROVER_VALUE_SOURCES`, as the installed spec types it. */
export type ApproverValueSource = (typeof APPROVER_VALUE_SOURCES)[keyof typeof APPROVER_VALUE_SOURCES];

/**
 * The registry member of the spec's approver value binding (objectstack#22710):
 * the value is the machine name of an item of metadata `type`.
 */
export type RegistryValueSource = Extract<ApproverValueSource, { source: 'registry' }>;

/**
 * Read one binding as the registry member, or `undefined`.
 *
 * A registry entry with no usable `type` is not a registry entry: a picker that
 * lists nothing would be the failure this binding exists to end, so the caller
 * stays on whatever it would have done without it.
 */
export function registryValueSourceOf(raw: unknown): RegistryValueSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as { source?: unknown; type?: unknown };
  return s.source === 'registry' && typeof s.type === 'string' && s.type
    ? { source: 'registry', type: s.type }
    : undefined;
}

/** Approver kind → the metadata type its value names, for every registry-bound kind in `sources`. */
export function registryTypesOf(sources: Readonly<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sources).flatMap(([kind, source]) => {
      const registry = registryValueSourceOf(source);
      return registry ? [[kind, registry.type]] : [];
    }),
  );
}

/**
 * The registry-bound approver kinds of the bundled spec, kind → metadata type —
 * `{ position: 'position' }` on a spec carrying objectstack#22710, which every
 * spec objectui installs since objectui#12030 does.
 */
export const APPROVER_REGISTRY_TYPES: Readonly<Record<string, string>> =
  registryTypesOf(APPROVER_VALUE_SOURCES);
