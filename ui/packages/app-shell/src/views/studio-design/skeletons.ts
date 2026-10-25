/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Minimal-valid draft skeletons for the Studio's INLINE "New X" creators
// (Data → object, Automations → flow, Interfaces → app, Access → permission).
//
// These bypass the metadata-admin registry, so `createConformance.test.ts`'s
// registry-driven gate does NOT cover them — a future edit to one of these
// shapes could make its "New" button a silent dead-end (create→save 422s). They
// live here, pure and exported, so BOTH the pillars and the conformance gate
// consume the SAME source: the test can't drift from what the designer emits.
//
// Label strings are parameters (the pillars pass localized `t(...)` values); the
// gate passes any placeholder — the labels don't affect spec validity.

import type { OwdCreateModel } from './owd-sharing.js';

/**
 * A new object's draft body.
 *
 * `sharingModel` is a REQUIRED parameter, not an optional one with a default
 * baked in here. An object with no OWD is refused at the publish door
 * (`security-owd-unset`, ADR-0090 D1) — the refusal the author used to meet
 * only after building the whole object — and the spec's own minimal create
 * body carries the key for exactly that reason. Making it a required
 * parameter means the value has to come from a create surface that ASKED for
 * it: a future second create path cannot quietly omit the baseline, because
 * omitting it does not type-check.
 */
export function buildObjectSkeleton(
  name: string,
  label: string,
  nameFieldLabel: string,
  sharingModel: OwdCreateModel,
): Record<string, unknown> {
  return {
    name,
    label,
    sharingModel,
    fields: { name: { type: 'text', label: nameFieldLabel } },
  };
}

export function buildFlowSkeleton(name: string, label: string, startLabel: string, endLabel: string): Record<string, unknown> {
  return {
    name,
    label,
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: startLabel },
      { id: 'end', type: 'end', label: endLabel },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };
}

/**
 * An object to seed a new app's navigation with (one menu item per object).
 * Its name only: the entry it becomes carries no label (see below).
 */
export interface AppNavSeed {
  name: string;
}

export function buildAppSkeleton(name: string, label: string, navObjects: AppNavSeed[] = []): Record<string, unknown> {
  return {
    name,
    label,
    active: true,
    // Seeding nav from the package's objects closes the create-app dead-end:
    // a fresh app otherwise ships zero menu items and every object must be
    // wired by hand in the Interfaces pillar (objectui#2262).
    //
    // Each seeded entry is a standard entry, so it is written with NO `label`
    // (objectui#11201, ruling B). An absent label inherits the object's CURRENT
    // label at render time, in the viewer's language. The entry used to store a
    // copy of the object's label, or its machine name for a draft or unlabelled
    // object: a present label, which the spec renders verbatim.
    navigation: navObjects.map((o) => ({ id: `nav_${o.name}`, type: 'object', objectName: o.name })),
  };
}

export function buildPermissionSkeleton(name: string, label: string): Record<string, unknown> {
  return { name, label, objects: {}, fields: {} };
}
