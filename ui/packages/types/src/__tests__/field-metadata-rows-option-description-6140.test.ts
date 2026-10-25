// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6140 / objectui#6153 — the ruled declarations on the field-metadata
 * face (maintainer 2026-08-25, Option A, verbatim ruling recorded on #6140):
 *
 *   1. `rows?: number` on `MarkdownFieldMetadata` AND `HtmlFieldMetadata`,
 *      aligning the `TextareaFieldMetadata` precedent — `RichTextField` (the
 *      one widget behind the `markdown`/`html`/`richtext` registry keys,
 *      objectui#5498) has always read the key through an `as any` while no
 *      rich-content type declared it.
 *   2. `description?: string` on `SelectOptionMetadata` (objectui#6153
 *      instance 2) — `LookupField` SEARCHES it on authored static options and
 *      `recordToOption` emits it for fetched records, while the declared
 *      option type refused it.
 *
 * And the ruling's fence, pinned as hard as the grants:
 *
 *   3. The four inert rich-text editor keys (`toolbar`/`preview`/`minHeight`/
 *      `maxHeight`) stay UNDECLARED — "the capability expansion stops at
 *      `rows`" is the ruling's own sentence. Nothing in `packages/fields/src`
 *      reads any of them (measured on #6140).
 *
 * ## Why membership pins are type-level here
 *
 * These are plain interfaces with NO index signature and no zod mirror
 * (`src/zod/` has no field-types mirror), so an undeclared member read is a
 * compile error and `Equal<…>` cannot be satisfied by an index-signature
 * fallback. The pins bite under `tsc -p tsconfig.test.json` (the package's
 * `type-check` chain), not under the vitest RUNTIME — which is why each grant
 * also carries a READ-SITE pin below (the house form of
 * `undeclared-but-consumed-keys-6150.test.ts`): the declaration is worth its
 * doc comment only while the consuming read exists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type {
  HtmlFieldMetadata,
  LookupFieldMetadata,
  MarkdownFieldMetadata,
  SelectFieldMetadata,
  SelectOptionMetadata,
  TextareaFieldMetadata,
} from '../field-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/* ── Type-level helpers (invariant equality, house form) ─────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── 1+2. The declared members, pinned invariantly ───────────────────────── */

export type _MarkdownRowsIsNumber = Expect< Equal< NonNullable< MarkdownFieldMetadata['rows'] >, number > >;
export type _HtmlRowsIsNumber = Expect< Equal< NonNullable< HtmlFieldMetadata['rows'] >, number > >;
// The precedent the ruling aligns to — pinned so the three multiline types
// cannot drift apart again.
export type _TextareaRowsIsNumber = Expect< Equal< NonNullable< TextareaFieldMetadata['rows'] >, number > >;
export type _OptionDescriptionIsString = Expect< Equal< NonNullable< SelectOptionMetadata['description'] >, string > >;

/* ── 3. The fence: the four inert editor keys stay undeclared ────────────── */

type IsMember< T, K extends string > = K extends keyof T ? true : false;

export type _NoToolbarOnMarkdown = Expect< Equal< IsMember< MarkdownFieldMetadata, 'toolbar' >, false > >;
export type _NoPreviewOnMarkdown = Expect< Equal< IsMember< MarkdownFieldMetadata, 'preview' >, false > >;
export type _NoMinHeightOnMarkdown = Expect< Equal< IsMember< MarkdownFieldMetadata, 'minHeight' >, false > >;
export type _NoMaxHeightOnMarkdown = Expect< Equal< IsMember< MarkdownFieldMetadata, 'maxHeight' >, false > >;
export type _NoToolbarOnHtml = Expect< Equal< IsMember< HtmlFieldMetadata, 'toolbar' >, false > >;
export type _NoPreviewOnHtml = Expect< Equal< IsMember< HtmlFieldMetadata, 'preview' >, false > >;
export type _NoMinHeightOnHtml = Expect< Equal< IsMember< HtmlFieldMetadata, 'minHeight' >, false > >;
export type _NoMaxHeightOnHtml = Expect< Equal< IsMember< HtmlFieldMetadata, 'maxHeight' >, false > >;

/* ── The authoring proof: annotated literals carry the keys ──────────────── */
// These assignments are the excess-property check that FAILED before the
// declarations landed — an author (human or AI) could not legally write what
// the running widget honoured. Compiling at all is the assertion.

export const _markdownWithRows: MarkdownFieldMetadata = {
  type: 'markdown',
  name: 'release_notes',
  rows: 12,
};

export const _htmlWithRows: HtmlFieldMetadata = {
  type: 'html',
  name: 'email_body',
  rows: 6,
};

export const _selectWithOptionDescription: SelectFieldMetadata = {
  type: 'select',
  name: 'status',
  options: [{ label: 'Active', value: 'active', description: 'Currently being worked' }],
};

export const _lookupWithOptionDescription: LookupFieldMetadata = {
  type: 'lookup',
  name: 'priority',
  reference: 'priorities',
  options: [{ label: 'High', value: 'high', description: 'Blocks the release' }],
};

/* ── Read-site pins ──────────────────────────────────────────────────────── */

const readSites: Array<{ file: string; text: string; why: string }> = [
  {
    file: 'packages/fields/src/widgets/RichTextField.tsx',
    // objectui#12242 intersected the host-written `mobile_fullscreen`'s hand-off
    // into the same declared cast; the carrier is still read through declared types.
    text: 'const richField = field as (MarkdownFieldMetadata | HtmlFieldMetadata) & LongTextCarrierHandoff;',
    why: 'the DECLARED carrier — the `as any` this card retired must not come back',
  },
  {
    file: 'packages/fields/src/widgets/RichTextField.tsx',
    text: 'const rows = richField?.rows || 8;',
    why: 'the consuming read `rows` was declared FOR (objectui#6140)',
  },
  {
    file: 'packages/fields/src/widgets/TextAreaField.tsx',
    text: 'const rows = textareaField?.rows || 4;',
    why: 'the precedent read the ruling aligns to',
  },
  {
    file: 'packages/fields/src/widgets/TextAreaField.tsx',
    text: 'const textareaField = field as TextareaFieldMetadata & LongTextCarrierHandoff;',
    why: 'the precedent widget reads through the declared type too',
  },
  {
    file: 'packages/fields/src/widgets/LookupField.tsx',
    text: '(opt.description && opt.description.toLowerCase().includes(q))',
    why: 'the search consumption `description` was declared FOR (objectui#6153)',
  },
  {
    file: 'packages/fields/src/widgets/LookupField.tsx',
    text: 'const option = { value: val, label: String(label), description, ...record };',
    why: 'recordToOption emits the same key for fetched records',
  },
];

describe('objectui#6140/#6153 — declared field-metadata keys and their live reads', () => {
  describe.each(readSites.map((s) => [`${s.file} — ${s.why}`, s] as const))('%s', (_title, s) => {
    it('the read site still exists — the fact the declaration records', () => {
      const src = readFileSync(join(REPO_ROOT, s.file), 'utf8');
      expect(src, `${s.file} no longer contains \`${s.text}\``).toContain(s.text);
    });
  });

  it('the retired cast is gone from both long-text widgets', () => {
    for (const file of [
      'packages/fields/src/widgets/RichTextField.tsx',
      'packages/fields/src/widgets/TextAreaField.tsx',
    ]) {
      const src = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect(src, `${file} launders the metadata carrier through \`field as any\` again`).not.toContain(
        'field as any',
      );
    }
  });

  it('the four inert editor keys have no read in packages/fields/src (the fence held)', () => {
    // Same measurement #6140 recorded: `minHeight`/`maxHeight` have zero
    // occurrences; `toolbar` and `preview` occur only in prose/JSDoc or on
    // OTHER widgets. A new READ of one of these off rich-text field metadata
    // is a capability expansion the ruling explicitly stopped short of.
    for (const file of [
      'packages/fields/src/widgets/RichTextField.tsx',
      'packages/fields/src/widgets/TextAreaField.tsx',
    ]) {
      const src = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const key of ['toolbar', 'preview', 'minHeight', 'maxHeight']) {
        expect(src, `${file} reads \`${key}\` off the metadata carrier`).not.toMatch(
          new RegExp(`(?:richField|textareaField)\\??\\.${key}\\b`),
        );
      }
    }
  });
});
