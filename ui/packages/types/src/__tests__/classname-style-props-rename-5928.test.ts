/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `StylePropsSchema` is RENAMED to `ClassNameStylePropsSchema` on the published
 * `@object-ui/types/zod` surface — outright, with no deprecated alias standing in
 * for the old name (objectui#5928).
 *
 * ## What this file exists to prove
 *
 * The rename moves a name on a PUBLISHED surface, so the new name has to be
 * checked the way a published export is checked — by IMPORTING it through the
 * published barrel and USING it. Nothing else in this package imports the barrel's
 * copy of this name, so without this file the barrel line is load-bearing for
 * nobody and can be dropped in silence. Measured on this branch by deleting
 * `ClassNameStylePropsSchema` from `../zod/index.zod.ts`: this suite fails at
 * module load, and `tsc -p tsconfig.test.json` fails with TS2305 at the import
 * below — both of them only because this file names the export.
 *
 * The import is a VALUE import rather than a type-only one, because the type level
 * cannot see the half that matters: a type import erases, while the `safeParse`
 * pair below proves the published name still resolves to a LIVE zod schema at
 * runtime and not to something that lost its identity in the rename.
 *
 * Both faces of the rename are pinned here:
 *   - the barrel publishes the new name and it VALIDATES — a live zod schema that
 *     also REFUSES, with the issue addressed to the offending key, so the export is
 *     the schema and not an inert re-export of something that lost its identity in
 *     the rename — and the retired name is no longer among the barrel's exports;
 *   - the object carries exactly the two keys the new name claims, so the name
 *     cannot outlive what it describes.
 *
 * ## What is NOT pinned here, and where it lives instead
 *
 * That the retired name cannot come back as a DEFINITION is already a ratchet in
 * `zod-mirror-parity.test.ts`: its census reads every `export const` in `../zod/`
 * and fails on one that is neither a registered pair nor an excluded one, so
 * re-declaring `StylePropsSchema` there reddens that suite with no help from this
 * file. What that census cannot see — it matches `export const` declarations — is
 * the same name returning as a re-export alias (`export { X as Y }`), which is why
 * the absence below is read off the barrel's own export list rather than restated
 * against the source.
 *
 * The other half of the card — that the old name never was a mirror of the
 * like-named TS `StyleProps`, the Tailwind-scale vocabulary it shares no key with —
 * is recorded with its reason in that same file's `EXCLUSIONS`, now keyed to the
 * name this const actually carries.
 */

import { describe, it, expect } from 'vitest';

// The PUBLISHED path (`@object-ui/types/zod` resolves to this barrel), deliberately
// not `../zod/base.zod.js`: a const that survives in the source file but never
// reaches the barrel is exactly the regression this import must catch, and a
// missing named export fails this module at link time.
import { ClassNameStylePropsSchema } from '../zod/index.zod.js';

describe('ClassNameStylePropsSchema (objectui#5928)', () => {
  it('the published barrel exports it as a live schema — and no longer carries the retired name', async () => {
    const ok = ClassNameStylePropsSchema.safeParse({ className: 'p-4 text-sm', style: { color: 'red', zIndex: 10 } });
    expect(ok.success).toBe(true);

    // A refusal addressed to the key that is wrong — the accept set is this
    // schema's, not a passthrough of anything.
    const bad = ClassNameStylePropsSchema.safeParse({ className: 42 });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(['className']);

    // The rename is a removal too: `StylePropsSchema` left the published surface
    // with it, under no spelling — no alias, no re-export.
    const zodBarrel = await import('../zod/index.zod.js');
    expect(
      'StylePropsSchema' in zodBarrel,
      '`StylePropsSchema` is back on the published ./zod surface — the rename was outright, no alias',
    ).toBe(false);
    // Positive control on the same barrel object, same run: the surviving name IS
    // exported, so the refusal above measures the removal and not a broken import.
    expect('ClassNameStylePropsSchema' in zodBarrel).toBe(true);
  });

  it('it carries exactly the two keys its name claims', () => {
    // The rename was justified by a measurement (2 keys, both CSS passthrough
    // attributes). Pinned so the name cannot outlive what it describes: a third key
    // arriving here makes `ClassNameStyleProps…` a lie and must be a decision.
    expect(Object.keys(ClassNameStylePropsSchema.shape).sort()).toEqual(['className', 'style']);
  });
});
