/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RichtextFieldMetadata` — the third registry key of one widget becomes
 * DECLARABLE (objectui#7083, maintainer ruling of 2026-09-07, batch #71).
 *
 * ## What was missing, and why a cast was the only evidence
 *
 * `markdown`, `html` and `richtext` are one widget (objectui#5498). Two of the
 * three carried an exported metadata type; `richtext` carried none, so the
 * runtime served it happily by structure while an author could not write its
 * metadata under an annotation at all. The state was neither a union member
 * nor a recorded alias — a silent gap whose ONLY trace was a deliberate
 * `as unknown as MarkdownFieldMetadata` in `RichTextField.rows.test.tsx`. That
 * cast is gone; this file is what replaces it, so the gap cannot be
 * rediscovered by the next reader who trips over a cast.
 *
 * ## The pin has two halves and needs both
 *
 * The ruling asks that "a typed `richtext` literal compiles AND the widget
 * renders it", and the compile half is not decoration: a pin that only rendered
 * would still pass with the cast in place, which is the state this card ends.
 *
 *  - COMPILE — {@link richtextField} below is an annotated literal, so TypeScript's
 *    excess-property check judges every key in it, and it is assigned to
 *    `FieldMetadata` to pin the UNION membership the ruling actually granted.
 *    On the pre-change tree this file does not compile at all: there is no
 *    member to annotate against, which is what makes this leg non-vacuous.
 *  - RENDER — every key of the derived read set is then asserted at the DOM,
 *    each against a control that changes only that key, so a green here reads
 *    "the widget consumed the declared key" and never "the default happened to
 *    match".
 *
 * ## The read set is DERIVED from `RichTextField.tsx`, not copied
 *
 * `type` (`resolveRichTextFieldType`, the discriminator), `rows`
 * (`richField?.rows || 8`), `placeholder`, `mobile_fullscreen` and `label` are
 * the five keys the widget reads off this carrier on the `richtext` path
 * (`mobile_fullscreen` is the host-written one, typed on
 * `LongTextCarrierHandoff` since objectui#12242, so the literal below is
 * annotated with both); the
 * readonly branch hands `field` to a `RICH_TEXT_CELL_RENDERERS` entry, and both
 * renderers there read `value` only. The sixth key, `maxLength`, is read by
 * the widget too (the native stop and the counter, objectui#8438) and by the
 * FORM: `buildValidationRules` is generic and compiles it into a submit-time
 * rule for every field. It is `@objectstack/spec`'s `FieldSchema.maxLength`
 * by reference, and it replaced the snake_case `max_length` when objectui#11070
 * retired that spelling. The last group below pins the spec-boundary reading
 * for the two spellings — see the member's own docblock in
 * `packages/types/src/field-types.ts`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FieldSchema } from '@objectstack/spec/data';
import type { FieldMetadata, RichtextFieldMetadata } from '@object-ui/types';

import { RichTextField } from '../RichTextField';
import type { LongTextCarrierHandoff } from '../longTextCarrierHandoff';

/**
 * The whole derived read set in ONE annotated literal.
 *
 * Annotated, never `as`: the annotation is what makes TypeScript judge each
 * key, and judging each key is the half of this pin that a cast would have
 * silently satisfied.
 */
const richtextField: RichtextFieldMetadata & LongTextCarrierHandoff = {
  type: 'richtext',
  name: 'doc',
  label: 'Release notes',
  rows: 10,
  placeholder: 'Write the release notes…',
  mobile_fullscreen: true,
  maxLength: 5000,
};

describe('RichtextFieldMetadata — the declarable face of the `richtext` key', () => {
  it('is a member of the `FieldMetadata` union and discriminates on `type`', () => {
    const asUnion: FieldMetadata = richtextField;

    // The runtime half of the same statement, so the assertion is not purely a
    // compile-time artefact that a `// @ts-expect-error` sweep could hide.
    expect(asUnion.type).toBe('richtext');

    // …and the union NARROWS on it: reaching `rows` through the union without a
    // cast is the authoring capability the ruling granted. Before this member
    // existed there was no branch of the union this literal could inhabit.
    if (asUnion.type !== 'richtext') throw new Error('unreachable: literal is a richtext field');
    expect(asUnion.rows).toBe(10);
    expect(asUnion.maxLength).toBe(5000);
  });

  it('renders the declared `rows` on the inline editor', () => {
    render(<RichTextField value="<p>hi</p>" onChange={() => {}} field={richtextField} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '10');
  });

  it('renders the declared `maxLength` as the native stop', () => {
    render(<RichTextField value="" onChange={() => {}} field={richtextField} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '5000');
  });

  it('renders the declared `placeholder`', () => {
    render(<RichTextField value="" onChange={() => {}} field={richtextField} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Write the release notes…');
  });

  it('renders the expand affordance for `mobile_fullscreen`, titled with `label`', () => {
    render(<RichTextField value="<p>hi</p>" onChange={() => {}} field={richtextField} />);

    const toggle = screen.getByTestId('richtext-fullscreen-toggle');
    expect(toggle).toBeInTheDocument();

    // `label` reaches the dialog title, which is a direct render of the key
    // rather than an interpolated sentence — so this assertion cannot be
    // satisfied by a fallback string.
    fireEvent.click(toggle);
    expect(screen.getByTestId('richtext-fullscreen-dialog')).toBeInTheDocument();
    expect(screen.getByText('Release notes')).toBeInTheDocument();
  });

  it('control: the same widget, same type, with the optional keys omitted', () => {
    // One key different per assertion above; here they are all absent at once,
    // and the widget answers with its own defaults. Without this, a green above
    // would be compatible with the widget ignoring the metadata entirely.
    const bare: RichtextFieldMetadata = { type: 'richtext', name: 'doc' };
    render(<RichTextField value="" onChange={() => {}} field={bare} />);

    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '8');
    expect(screen.getByRole('textbox')).not.toHaveAttribute('maxlength');
    expect(screen.getByRole('textbox')).not.toHaveAttribute('placeholder', 'Write the release notes…');
    expect(screen.queryByTestId('richtext-fullscreen-toggle')).not.toBeInTheDocument();
  });
});

/**
 * The spec-boundary reading for the ceiling key, in both spellings.
 *
 * ⛔ This group is NOT the reason `maxLength` is declared. That reason is its
 * two readers — the widget and `buildValidationRules`. This reading is
 * NON-DISCRIMINATING across types: at `@objectstack/spec` 17.3.0 the authoring
 * boundary answers IDENTICALLY for every field type, `text` included, so it
 * says nothing about `richtext` versus its two siblings.
 *
 * It is pinned anyway, for the three types this one widget serves, so the
 * member's docblock cannot rot into a false canonical claim about the spelling
 * — the failure mode objectui#7014 was opened for. The refused half is also
 * why objectui#11070 retired `max_length` rather than keeping it as an alias.
 */
describe('spec boundary — `richtext` is symmetric with `markdown`/`html` on the ceiling key', () => {
  const base = (type: string) => ({ name: 'body', type, label: 'Body' });

  /**
   * Pull the `unrecognized_keys` issue naming `key`, or undefined.
   *
   * Typed off `safeParse`'s own return rather than through `any`: narrowing on
   * the issue's `code` is what makes `keys` reachable, and it is also what
   * keeps this helper honest — an issue of a different code can never satisfy
   * it by carrying a same-named field.
   */
  const refusedByName = (result: ReturnType<typeof FieldSchema.safeParse>, key: string) =>
    result.success
      ? undefined
      : result.error.issues.find((i) => i.code === 'unrecognized_keys' && i.keys.includes(key));

  for (const type of ['markdown', 'html', 'richtext'] as const) {
    it(`control: \`${type}\` with no ceiling key is accepted`, () => {
      expect(FieldSchema.safeParse(base(type)).success).toBe(true);
    });

    it(`\`${type}\` ADMITS the spec's own \`maxLength\``, () => {
      expect(FieldSchema.safeParse({ ...base(type), maxLength: 5000 }).success).toBe(true);
    });

    it(`\`${type}\` refuses the objectui legacy spelling \`max_length\` BY NAME`, () => {
      const res = FieldSchema.safeParse({ ...base(type), max_length: 5000 });
      expect(res.success).toBe(false);
      expect(refusedByName(res, 'max_length'), `expected unrecognized_keys naming 'max_length' on ${type}`).toBeDefined();
      // Control, per fixture: the key is the only difference from the accepted
      // payload above, so "refused" is about the key and not about the field.
      expect(FieldSchema.safeParse(base(type)).success).toBe(true);
    });
  }
});
