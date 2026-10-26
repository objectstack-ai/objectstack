/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Block Schema (the whole family, RETIRED)
 *
 * This module exports NOTHING any more. It is kept as the ADR-0049 tombstone
 * for the block schema family, and `__tests__/block-family-retired-4895.test.ts`
 * dynamic-imports it to pin the retired names OUT of it.
 *
 * RETIRED (objectui#4895, ADR-0049 enforce-or-remove) under the maintainer
 * ruling recorded on that card on 2026-09-02 (director seat, summon #8,
 * maintainer verbatim 「同意」), option C1 — retire the family in one change,
 * no transition window. The names that lived here:
 *
 *   - `BlockSchema`         (`type: 'block'`)
 *   - `BlockSlot`           (`BlockSchema.slots[]` element)
 *   - `BlockLibrarySchema`  (`type: 'block-library'`)
 *   - `BlockEditorSchema`   (`type: 'block-editor'`)
 *   - `BlockInstanceSchema` (`type: 'block-instance'`)
 *   - `BlockVariable` / `BlockMetadata` / `BlockLibraryItem` — support types
 *     with no declaration site and no reader outside the five above
 *   - `ComponentSchema`     (`type: 'component'`) — the fifth arm of the zod
 *     `BlockComponentSchema` union, retired with it; see the note below
 *
 * Why. Declared-but-unenforced, the ADR-0049 shape to retire: zero
 * `ComponentRegistry.register()` sites claimed any of the four discriminants
 * (positive control `'table'` resolves to two), zero renderers, and zero
 * readers anywhere outside this package. The zod mirrors, however, were NOT
 * inert — they shipped as runtime values under the `./zod` subpath and their
 * discriminants were accepted by the published `AnyComponentSchema`, so an
 * author who copied the documented `{ type: 'block-library' }` got a GREEN
 * validator and then the registry's "Unknown component type" panel
 * (OBJUI-001). Validated-then-broken is worse than never-validated, because
 * the green light is what the author trusted. The liveness pass that this
 * card's earlier deferral was keyed to (objectui#6935) established that
 * external consumption of this package is structurally unmeasurable — the
 * certainly-live control `TableSchema` returns the same zero — so the ruling
 * was taken on the evidence in hand rather than on an exit that cannot fire.
 *
 * ⚠️ NOT the same family, and deliberately untouched: the live slotted
 * record-page vocabulary — `PageNodeSchema.kind === 'slotted'` with
 * `PageNodeSchema.slots?: PageSlotMap` (`./layout.ts`), rendered by
 * `usePageAssignment` / `PageBlockCanvas` / `PageBlockInspector` in
 * `@object-ui/app-shell`. It shares the words "block" and "slot" with the
 * family above and shares no declaration, no type and no file with it;
 * objectui#5937 drew that line first.
 *
 * The `ComponentSchema` note. The `type: 'component'` NAVIGATION item kind
 * (`{ type: 'component', componentRef: 'ns:name' }`, declared by
 * `NavigationItemSchema` in `./zod/app.zod.ts`, objectui#2918) is a DIFFERENT
 * declaration in a different module and is untouched by this retirement. What
 * went is the block family's own `ComponentSchema` node kind, which carried
 * `componentName` / `props` / `children` and, like its four siblings, was
 * registered nowhere.
 *
 * @module blocks
 * @packageDocumentation
 */

// Kept a module on purpose — the retirement pin above dynamic-imports this
// file — with nothing left to export.
export {};
