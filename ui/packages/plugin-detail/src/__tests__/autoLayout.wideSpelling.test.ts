/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4250 — `WIDE_FIELD_TYPES` is matched against the RAW field type, and
 * its rich-text members were `rich-text` / `field:rich-text`: spellings
 * `@objectstack/spec` REJECTS (they exist only as typo keys in the spec's own
 * `suggestFieldType` table), so the set never widened a rich-text field while
 * `markdown` and `html` beside it did.
 *
 * The pins below are DERIVED, not enumerated (the #4226/#4207 precedent): the
 * bare members are checked against the spec's own `FieldType` vocabulary, and
 * the `field:` half is read out of `mapFieldTypeToFormType` rather than retyped.
 * So the next spelling drift fails BY NAME — "'rich-text' is not a spec
 * FieldType" — instead of passing vacuously the way
 * `isWideFieldType('rich-text')` did.
 */
import { describe, it, expect } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import { mapFieldTypeToFormType } from '@object-ui/fields';
import { isWideFieldType, applyAutoSpan } from '../autoLayout';

/**
 * The spec's own `FieldType` vocabulary.
 *
 * The wrapper walk is `@object-ui/test-support`'s shared reader (objectui#6924);
 * the THROW stays HERE, because the reader deliberately answers `[]` rather than
 * raising and this read is module-scope. What it replaces was a NON-OPTIONAL
 * cast of the enum node to an options-bearing shape, spread directly — which
 * failed LOUDLY the moment the cast stopped holding (spreading `undefined`
 * throws), so a bare `enumOptions` call here would have traded a loud failure
 * for a silently empty vocabulary: the derived assertions below would then pass
 * over nothing. That trade is the regression objectui#7025 exists to refuse.
 * (The retired spelling is deliberately NOT quoted here: the card's enumeration
 * instrument is a grep for it, and a comment carrying the literal text makes
 * every future re-derivation of this population read a false positive.)
 */
const readSpecTypes = (): readonly string[] => {
  const options = enumOptions(FieldType);
  if (options.length === 0) {
    throw new Error('could not read FieldType.options from @objectstack/spec');
  }
  return options;
};

const SPEC_TYPES: readonly string[] = readSpecTypes();

/**
 * The long-form / document family: the spec types whose value is a whole block
 * of prose and therefore takes the full row. Spelled here as the SPEC spells
 * them — the first assertion below is what makes that claim checkable.
 */
const WIDE_SPEC_TYPES = ['textarea', 'markdown', 'html', 'richtext'] as const;

/** Spellings the spec rejects. Kept as data so the pin says what it rejects. */
const REJECTED_SPELLINGS = ['rich-text', 'rich_text'] as const;

describe('detail WIDE_FIELD_TYPES — keyed on the spec vocabulary (#4250)', () => {
  it('every bare member this set relies on IS a spec FieldType name', () => {
    // The derivation. If a spelling drifts out of the spec vocabulary — exactly
    // what `rich-text` had done — this fails and NAMES the offender, without
    // needing a field to reach the set for it to show.
    for (const type of WIDE_SPEC_TYPES) {
      expect(SPEC_TYPES).toContain(type);
    }
  });

  it('widens every long-form spec type', () => {
    for (const type of WIDE_SPEC_TYPES) {
      expect(isWideFieldType(type)).toBe(true);
    }
  });

  it('widens the widget id each long-form type maps to', () => {
    // Derives the `field:*` half from the alias table instead of retyping it,
    // so the two halves of the set cannot drift apart: `field:rich-text` was
    // wrong precisely because `mapFieldTypeToFormType('richtext')` has always
    // returned `field:richtext`.
    for (const type of WIDE_SPEC_TYPES) {
      expect(isWideFieldType(mapFieldTypeToFormType(type))).toBe(true);
    }
  });

  it('does not answer to spellings the spec rejects', () => {
    for (const dead of REJECTED_SPELLINGS) {
      expect(SPEC_TYPES).not.toContain(dead);
      // Dropped rather than carried alongside: the alias table is the one place
      // aliases live (the ruling on #4250).
      expect(isWideFieldType(dead)).toBe(false);
      expect(isWideFieldType(`field:${dead}`)).toBe(false);
    }
  });

  it('its spec-facing surface is EXACTLY the long-form family', () => {
    // The complement, so a stray spec type cannot be added without saying so.
    // `grid` is absent from this assertion by construction: it is not a spec
    // FieldType but a sanctioned objectui-local key (`GridFieldMetadata` in
    // `@object-ui/types`), so it is not part of the spec-facing surface.
    // `repeater` — the spec type whose widget IS `field:grid` — is deliberately
    // NOT wide here; that asymmetry is filed separately rather than fixed under
    // this card.
    const wideSpecTypes = SPEC_TYPES.filter((t) => isWideFieldType(t));
    expect([...wideSpecTypes].sort()).toEqual([...WIDE_SPEC_TYPES].sort());
  });

  it('spans a richtext field across the section, like markdown beside it', () => {
    // The behaviour, not the membership: the same call the detail layout makes.
    const fields = [
      { name: 'subject', type: 'text' },
      { name: 'body', type: 'richtext' },
      { name: 'notes', type: 'markdown' },
    ] as any;
    const out = applyAutoSpan(fields, 3);
    expect(out[0].span).toBeUndefined();
    expect(out[1].span).toBe(3);
    expect(out[2].span).toBe(3);
  });
});
