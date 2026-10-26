/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The surviving renderer's face IS a declared arm (objectui#7664, maintainer
 * ruling (a), 2026-09-05 — re-based on the 2026-09-09 family retirement).
 *
 * ## What objectui#8802 / objectui#8257 did to this file, and why it is a
 * rewrite rather than a deletion
 *
 * objectui#7664's ruling was about FOUR registered kanban keys and one shared
 * declaration: `'kanban'`, `'kanban-ui'`, `'kanban-enhanced'`, `'object-kanban'`.
 * Three of the four RETIRED on 2026-09-09 (objectui#8802 for the bare `kanban`
 * node key, objectui#8257 for the other two), and `KanbanSchema` — the dialect
 * this file was written to pin — retired with the first of them.
 *
 * ⛔ The claim objectui#7664 established did NOT retire with them: "the
 * registered renderer's props type-check against the declared schema, and the
 * declaration lives in `@object-ui/types` rather than being re-declared here."
 * That claim is now about ONE key, and this file asserts it about that key. The
 * legs that named a retired key moved to
 * `kanban-family-registry-keys-retired-8257.test.ts`, which owns the retirement
 * itself — including the anti-vacuity control that the surviving key is still
 * registered.
 *
 * ## The instrument
 *
 * Compile-time. Vitest strips types without checking them, so a green run of
 * this file proves nothing on its own; the assertions are read by
 * `tsc -p packages/plugin-kanban/tsconfig.test.json`, chained off this
 * package's `type-check` script. That project sets `"paths": {}`, so
 * `@object-ui/types` resolves through the workspace dependency to
 * `packages/types/dist/index.d.ts` — BUILD `@object-ui/types` before believing
 * either colour this file reports. The one runtime assertion — the surviving
 * registration exists — is the anti-vacuity control for the prop-type pins:
 * a prop type is only worth pinning for a renderer that is registered.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import type {
  SchemaRegistry,
  ObjectQLComponentSchema,
  ObjectKanbanSchema as DeclaredObjectKanbanSchema,
  KanbanColumn as DeclaredKanbanColumn,
  KanbanCard as DeclaredKanbanCard,
} from '@object-ui/types';
import type { KanbanColumn, KanbanCard } from '../types';
import type { ObjectKanbanComponentProps } from '../ObjectKanban';
import '../index';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

// Non-vacuity controls: `any` on either side would satisfy every `extends`
// below while checking nothing.
type _FaceIsReal = Assert<Equal<IsAny<DeclaredObjectKanbanSchema>, false>>;
type _RegistryIsReal = Assert<Equal<IsAny<SchemaRegistry>, false>>;

// 1. ONE declaration: what this package exports as `KanbanColumn` / `KanbanCard`
//    is the `@object-ui/types` declaration, not a structurally-equal copy.
//    `Equal` is invariant, so a re-declared twin that drifted by one member
//    turns this red. (`KanbanSchema` was the third member of this row until
//    objectui#8802 retired it with the bare `kanban` node key; the two that
//    remain are consumed by `KanbanImpl` and `CardTemplates` and are NOT
//    retired.)
type _ColumnIsTheDeclaredOne = Assert<Equal<KanbanColumn, DeclaredKanbanColumn>>;
type _CardIsTheDeclaredOne = Assert<Equal<KanbanCard, DeclaredKanbanCard>>;

// 2. The map that calls itself the Single Source of Truth no longer offers the
//    RETIRED key. objectui#7645's defect was that `SchemaRegistry['kanban']`
//    named a type the registered renderer did not consume; objectui#8802 closed
//    it the other way, by retiring the key.
//
//    ⚠️ Measured rather than assumed, and NOT repaired here: this map has never
//    carried an `'object-kanban'` entry either, so the positive half of this pin
//    cannot be spelled against it. The union is where the surviving face is
//    reachable, so that is where the positive leg is asserted.
type _RetiredKeyIsGoneFromTheMap = Assert<Equal<'kanban' extends keyof SchemaRegistry ? true : false, false>>;
//    Non-vacuity: a live sibling key IS still in the map, so the `false` above
//    is a reading and not a `keyof` that answers `false` to everything.
type _MapStillHasLiveKeys = Assert<Equal<'chatbot' extends keyof SchemaRegistry ? true : false, true>>;
//    And the surviving face is the one the ObjectQL union selects for the key.
type _UnionSelectsTheDeclaredFace = Assert<
  Equal<Extract<ObjectQLComponentSchema, { type: 'object-kanban' }>, DeclaredObjectKanbanSchema>
>;

// 3. The renderer's props type-check against the declared schema: `ObjectKanban`
//    (behind `ObjectKanbanRenderer`, now registered for `'object-kanban'` ALONE)
//    accepts the declared face as its `schema`.
//
//    ⚠️ Assignability, not identity, and deliberately so — that is the form
//    objectui#7322 item ② settled on when the prop served two keys. It stays
//    assignability now that it serves one, because the ruling's own words are
//    that the props "type-check against the declared schema"; identity was only
//    ever the shape the prop happened to have.
type _ObjectKanbanTakesTheDeclaredFace = Assert<
  DeclaredObjectKanbanSchema extends ObjectKanbanComponentProps['schema'] ? true : false
>;

// 4. The declared face is still a tagged node, and a raw record field on a
//    card still reads `any` (the open-record index signature survived the move).
type _FaceIsTagged = Assert<Equal<DeclaredObjectKanbanSchema['type'], 'object-kanban'>>;
type _CardIsAnOpenRecord = Assert<Equal<IsAny<KanbanCard['dueDate']>, true>>;

describe('the registered kanban renderer consumes the declared arm (objectui#7664)', () => {
  it('is pinned at compile time', () => {
    expect(true).toBe(true);
  });

  it('the ONE surviving registration exists — the prop-type pins above are about a live renderer', () => {
    expect(ComponentRegistry.has('object-kanban'), '`object-kanban` is not registered').toBe(true);
    // Firing control on the same instrument: a name nothing registers answers
    // `false`, so the `true` above is a reading rather than a matcher that
    // agrees with everything.
    expect(ComponentRegistry.has('zzz-not-a-type')).toBe(false);
  });
});
