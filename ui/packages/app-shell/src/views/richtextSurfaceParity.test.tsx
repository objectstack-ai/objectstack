/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4250 — the CROSS-SURFACE control. Four sets across three packages
 * decide how a long-form field is placed, each matched against the RAW type,
 * and each spelled the rich-text type in a way `@objectstack/spec` rejects
 * (`rich_text` / `rich-text` — typo keys in the spec's own `suggestFieldType`
 * table, never a producer's output). The card's warning was that fixing only
 * some of them is WORSE than the uniform gap, because then the detail page and
 * the form disagree about the same field.
 *
 * So this file asks all three placement rules about ONE shared fixture field,
 * from the package that depends on every one of them.
 *
 * READ THIS BEFORE TREATING A GREEN RUN AS PROOF OF THE FIX: the parity
 * assertions here were green BEFORE the fix too — the four sets were uniformly
 * wrong, which is agreement of a kind. Their job is to go red on a HALF fix,
 * and that is how they were verified (reverting one set alone turns
 * `agree on EVERY spec field type` red). The red-before-green-after pins for
 * the fix itself live in each package: `autoLayout.wideSpelling.test.ts` in
 * plugin-detail / plugin-form, and `RelatedList.longFormColumns.test.tsx` for
 * the rendered column set.
 */
import { describe, it, expect } from 'vitest';
import { FieldType } from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
import { isWideFieldType as detailIsWide } from '@object-ui/plugin-detail';
import { isWideFieldType as formIsWide } from '@object-ui/plugin-form';
import { isSecondaryField } from './RecordDetailView';

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
 * ONE fixture, read by all three rules. `body` is the field the card is about;
 * `subject` is the narrow control that must stay primary and narrow everywhere.
 */
const OBJECT_FIELDS: Record<string, { type: string; label: string }> = {
  subject: { type: 'text', label: 'Subject' },
  body: { type: 'richtext', label: 'Body' },
  notes: { type: 'markdown', label: 'Notes' },
};

describe('richtext placement — one field, three surfaces (#4250)', () => {
  it('the fixture is spelled the way the spec spells it', () => {
    // The derivation that makes everything below meaningful: if this type name
    // is not in the spec vocabulary, no producer can emit it and every
    // assertion underneath is vacuous — which is exactly how the previous
    // `isWideFieldType('rich-text')` pin stayed green over a dead rule.
    expect(SPEC_TYPES).toContain(OBJECT_FIELDS.body.type);
    expect(SPEC_TYPES).toContain(OBJECT_FIELDS.notes.type);
  });

  it('the SAME richtext field is wide in the detail view and in the form', () => {
    const type = OBJECT_FIELDS.body.type;
    expect(detailIsWide(type)).toBe(true);
    expect(formIsWide(type)).toBe(true);
    expect(detailIsWide(type)).toBe(formIsWide(type));
  });

  it('the SAME richtext field is secondary on the record detail page', () => {
    expect(isSecondaryField('body', OBJECT_FIELDS.body)).toBe(true);
    // The narrow control: a plain text field stays primary…
    expect(isSecondaryField('subject', OBJECT_FIELDS.subject)).toBe(false);
    // …and is narrow on both layout surfaces.
    expect(detailIsWide(OBJECT_FIELDS.subject.type)).toBe(false);
    expect(formIsWide(OBJECT_FIELDS.subject.type)).toBe(false);
  });

  it('markdown — the sibling the card asked about — is placed identically', () => {
    const type = OBJECT_FIELDS.notes.type;
    expect(detailIsWide(type)).toBe(true);
    expect(formIsWide(type)).toBe(true);
    expect(isSecondaryField('notes', OBJECT_FIELDS.notes)).toBe(true);
  });

  it('the detail and form auto-layouts agree on EVERY spec field type', () => {
    // The card's warning, mechanized. Green before the fix and green after;
    // it fails the moment one of the two sets moves without the other.
    const disagreements = SPEC_TYPES.filter((t) => detailIsWide(t) !== formIsWide(t));
    expect(disagreements).toEqual([]);
  });

  it('no surface answers to a spelling the spec rejects', () => {
    // Dropped, not carried alongside (the ruling on #4250) — asserted on all
    // three surfaces at once so a "defensive" re-add cannot slip back into one.
    for (const dead of ['rich-text', 'rich_text']) {
      expect(SPEC_TYPES).not.toContain(dead);
      expect(detailIsWide(dead)).toBe(false);
      expect(formIsWide(dead)).toBe(false);
      expect(isSecondaryField('body', { type: dead, label: 'Body' })).toBe(false);
    }
  });
});
