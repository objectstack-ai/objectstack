/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ADR-0049 retirement of `CRUDSchema` / `type: 'crud'` (objectui#5373,
 * maintainer ruling of 2026-08-20), pinned at the two faces this package owns.
 *
 * Why these assertions and not a grep: `crud` had FOUR declaration faces and
 * zero registered renderers for the whole life of the key, so every check that
 * could have caught it was written against a face that agreed with the other
 * three. The two pins here are chosen for one property — each DISTINGUISHES the
 * two states of the world, i.e. each goes red if the retirement is reverted:
 *
 *   - the zod union `CRUDComponentSchema` REFUSES a `crud` node. Restore the
 *     `CRUDSchema` mirror as a union member and `safeParse` succeeds again.
 *   - the zod barrel no longer EXPORTS the mirror or its four sub-shapes.
 *     Restore them and the `not.toHaveProperty` assertions fail.
 *
 * Every negative carries a control drawn from the same object in the same run —
 * `detail` must still parse, `DetailSchema` / `CRUDDialogSchema` must still be
 * exported — because "crud is refused" is otherwise equally satisfied by the
 * union being broken outright or the barrel failing to load.
 *
 * The TS interface face cannot be pinned at runtime (types are erased) and is
 * covered by `tsc`: `packages/types` type-checks, and no `CRUDSchema` import
 * survives anywhere in the workspace. The validator face is pinned in
 * `@object-ui/core`'s `schema-validator.test.ts`, and the builder face in its
 * `schema-builder.test.ts`.
 */
import { describe, it, expect } from 'vitest';

import * as zodBarrel from '../zod/index.zod.js';
import { CRUDComponentSchema } from '../zod/crud.zod.js';

describe('CRUDSchema retirement (objectui#5373, ADR-0049 enforce-or-remove)', () => {
  it('the CRUD union refuses a `crud` node and still accepts a `detail` one', () => {
    const authoredCrud = {
      type: 'crud',
      title: 'Products',
      resource: 'products',
      api: '/api/products',
      columns: [{ name: 'name', label: 'Product Name' }],
    };
    expect(CRUDComponentSchema.safeParse(authoredCrud).success).toBe(false);
    // Control, same union, same run: a surviving member still parses, so the
    // refusal above is a verdict rather than a union that rejects everything.
    expect(CRUDComponentSchema.safeParse({ type: 'detail', title: 'Account' }).success).toBe(true);
  });

  it('the zod barrel exports neither the mirror nor its four sub-shapes', () => {
    for (const gone of [
      'CRUDSchema',
      'CRUDOperationSchema',
      'CRUDFilterSchema',
      'CRUDToolbarSchema',
      'CRUDPaginationSchema',
    ]) {
      expect(zodBarrel).not.toHaveProperty(gone);
    }
    // Controls: the CRUD module still exists and still exports its survivors.
    expect(zodBarrel).toHaveProperty('DetailSchema');
    expect(zodBarrel).toHaveProperty('CRUDDialogSchema');
    expect(zodBarrel).toHaveProperty('CRUDComponentSchema');
  });
});
