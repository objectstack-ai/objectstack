/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Block Schema Zod Validators (all RETIRED)
 *
 * This module exports NOTHING any more. It is kept as the ADR-0049 tombstone
 * for the block schema family's runtime validators, and
 * `__tests__/block-family-retired-4895.test.ts` dynamic-imports it to pin the
 * retired names OUT of it.
 *
 * RETIRED (objectui#4895, ADR-0049 enforce-or-remove) with the TypeScript half
 * in `../blocks.ts` — see that file for the ruling, the evidence and the
 * boundary against the live slotted record-page vocabulary. Ten values lived
 * here, and all ten were carried by `__tests__/zod-mirror-parity.test.ts`:
 *
 *   - `BlockVariableSchema`, `BlockSlotSchema`, `BlockMetadataSchema`,
 *     `BlockSchema`, `BlockLibraryItemSchema`, `BlockLibrarySchema`,
 *     `BlockEditorSchema`, `BlockInstanceSchema`, `ComponentSchema`
 *   - `BlockComponentSchema` — the discriminated union over the five node
 *     kinds above, and the arm through which `AnyComponentSchema`
 *     (`./index.zod.ts`) accepted every one of them
 *
 * This half is the one that mattered. The types were merely published; these
 * were published AND executable, so `AnyComponentSchema.safeParse({ type:
 * 'block-library' })` returned success for a node no page can render.
 * `./index.zod.ts` no longer carries a block arm and now refuses all five
 * kinds; `__tests__/phase2-schemas.test.ts` pins those refusals next to the
 * theme refusals retired the same way (`78cbdb530`, objectui#5647).
 *
 * Do NOT hand-write local mirrors of any retired schema here: re-declaring one
 * is a published-contract decision no ruling has taken, and the retirement pin
 * above fails if a retired name reappears.
 *
 * @module zod/blocks
 * @packageDocumentation
 */

// Kept a module on purpose — the retirement pin above dynamic-imports this
// file — with nothing left to export.
export {};
