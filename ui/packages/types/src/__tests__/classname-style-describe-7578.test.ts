/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ClassNameStylePropsSchema.description` names the two keys the object holds
 * (objectui#7578).
 *
 * ## What this file exists to prove
 *
 * objectui#5928 renamed the const off the over-broad `StyleProps` name; its
 * `.describe()` string was deliberately left alone by that PR and went on saying
 * exactly what the retired name said. That string is not a comment: on this
 * package `.describe()` is runtime metadata that reaches generated JSON-Schema
 * and docs, so it is the ONLY label the reader who never sees the const name
 * gets. #5928 therefore fixed the half of the problem that is visible in source
 * and left the published half standing — this file pins the published half.
 *
 * The description is read off the LIVE schema object exported by the published
 * barrel, not off the source text: a `.describe()` call that stops reaching the
 * schema (dropped in a refactor, or shadowed by a later `.describe()` up the
 * chain) leaves the source line looking correct while the emitted JSON-Schema
 * carries nothing, and only a runtime read tells those two apart.
 *
 * Three legs on the description, because "not the old string" and "the new
 * string" are different facts and a future edit can satisfy one without the
 * other: it EQUALS the current literal, it NAMES both keys verbatim so the label
 * cannot drift back to a generic word that leaves a reader hunting `padding` or
 * `gap` here, and it no longer carries the retired wording.
 *
 * ## Controls
 *
 * Two, so a red run here is readable as a description regression and not as
 * collateral from something larger:
 *   - the object's key set is unchanged — this card moved a string, not a shape;
 *   - a neighbouring schema in the same source file still carries its own
 *     description, so an edit that swept every `.describe()` in `base.zod.ts`
 *     reddens here too instead of passing as "the string changed".
 */

import { describe, it, expect } from 'vitest';

// The PUBLISHED path — `@object-ui/types/zod` resolves to this barrel. The
// description travels with the exported schema object, so it has to be read
// through the same door a consumer uses.
import { ClassNameStylePropsSchema, HTMLAttributesSchema } from '../zod/index.zod.js';

describe('ClassNameStylePropsSchema.description (objectui#7578)', () => {
  it('is the label that names the two keys', () => {
    expect(ClassNameStylePropsSchema.description).toBe('className and inline style');
  });

  it('names both keys verbatim, and no longer carries the retired wording', () => {
    const description = ClassNameStylePropsSchema.description ?? '';

    // Verbatim key spellings: the label has to survive being read with no source
    // in view, and the two property names are what the reader can act on.
    for (const key of Object.keys(ClassNameStylePropsSchema.shape)) {
      expect(description, `the description should name the \`${key}\` key`).toContain(key);
    }

    // The retired wording is the one #5928 renamed the const away from; it is
    // spelled out here once, as the thing being kept OUT.
    expect(description).not.toContain('Style properties');
  });

  it('control: the object still carries exactly the two keys it describes', () => {
    // A string change, not a shape change. If this leg moves, the card that moved
    // it owes a decision, not a re-label.
    expect(Object.keys(ClassNameStylePropsSchema.shape).sort()).toEqual(['className', 'style']);
  });

  it('control: a neighbouring schema in the same file keeps its own description', () => {
    // `HTMLAttributesSchema` is declared a few lines up in `../zod/base.zod.ts`
    // and is outside this card's scope. Its description is untouched, so this leg
    // stays green across the change above and reddens only if some edit went
    // through every `.describe()` in that file.
    expect(HTMLAttributesSchema.description).toBe('HTML attributes');
  });
});
