/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The block schema family stays retired (objectui#4895, ADR-0049).
 *
 * Maintainer ruling of 2026-09-02 (director seat, summon #8, verbatim 「同意」),
 * option C1: retire the family in one change, no transition window. The two
 * modules that held it are kept as tombstones exporting nothing, and this file
 * is what makes those tombstones executable — it dynamic-imports both and pins
 * every retired name OUT of them, the same shape
 * `spec-subschema-parity.test.ts` uses for the retired theme validators.
 *
 * Why a pin and not just a deletion. The names were on a PUBLISHED surface
 * (`@object-ui/types` at 17.x, subpaths `.` and `./zod`), so re-adding one is a
 * published-contract decision, not a convenience. Without this file the only
 * thing standing between a re-added `BlockSchema` and the published surface is
 * someone remembering the ruling.
 *
 * The refusal half — that `AnyComponentSchema` no longer green-lights any of
 * the five discriminants — is pinned in `phase2-schemas.test.ts`, next to the
 * theme refusals. This file pins the SYMBOLS; that one pins the BEHAVIOUR.
 */
import { describe, it, expect } from 'vitest';

/** Names that lived in `../blocks.ts`. */
const RETIRED_TYPES = [
  'BlockSchema',
  'BlockSlot',
  'BlockLibrarySchema',
  'BlockEditorSchema',
  'BlockInstanceSchema',
  'BlockVariable',
  'BlockMetadata',
  'BlockLibraryItem',
  'ComponentSchema',
] as const;

/** Names that lived in `../zod/blocks.zod.ts` — the ten parity-ledger entries. */
const RETIRED_VALIDATORS = [
  'BlockVariableSchema',
  'BlockSlotSchema',
  'BlockMetadataSchema',
  'BlockSchema',
  'BlockLibraryItemSchema',
  'BlockLibrarySchema',
  'BlockEditorSchema',
  'BlockInstanceSchema',
  'ComponentSchema',
  'BlockComponentSchema',
] as const;

describe('block schema family stays retired (objectui#4895, ADR-0049)', () => {
  it('the zod tombstone re-exports none of the ten retired validators', async () => {
    const blocksZod = await import('../zod/blocks.zod.js');
    for (const name of RETIRED_VALIDATORS) {
      expect(
        name in blocksZod,
        `'${name}' was retired with the block family (objectui#4895, maintainer ruling ` +
          `2026-09-02, option C1) — do not reintroduce it without a new ruling`,
      ).toBe(false);
    }
    // Non-vacuity control: the module must still BE a module. A failed import
    // would make every assertion above pass for the wrong reason.
    expect(typeof blocksZod).toBe('object');
  });

  it('the zod barrel no longer republishes them on the ./zod subpath', async () => {
    const zodBarrel = await import('../zod/index.zod.js');
    for (const name of RETIRED_VALIDATORS) {
      expect(name in zodBarrel, `'${name}' is back on the published ./zod surface`).toBe(false);
    }
    // Positive control on the same barrel: a live validator IS still exported,
    // so the refusals above measure the retirement, not a broken import.
    expect('TableSchema' in zodBarrel).toBe(true);
    expect('AnyComponentSchema' in zodBarrel).toBe(true);
  });

  it('the type tombstone is a module with nothing left to export', async () => {
    const blocks = await import('../blocks.js');
    // Types erase, so the runtime namespace of `../blocks.ts` is the only thing
    // observable here — and after the retirement it must be empty. The TYPE
    // half of this pin is the compile itself: `../index.ts` no longer re-exports
    // any of RETIRED_TYPES, and `type-check` would fail if it did while the
    // declarations are gone.
    expect(Object.keys(blocks)).toEqual([]);
    for (const name of RETIRED_TYPES) {
      expect(name in blocks, `'${name}' is back in the blocks tombstone`).toBe(false);
    }
  });
});
