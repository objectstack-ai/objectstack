/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27417 — the markdown / html / richtext editor's
 * placeholder is prose, not source.
 *
 * The textarea is `font-mono` because what a person types into it is markdown
 * or HTML source. Its placeholder inherited the same face, so a public form's
 * "Describe your request" read as code. The placeholder now takes the sans
 * stack and the typed source keeps mono.
 *
 * jsdom computes no `::placeholder` style, so this pins the utility pair on
 * the control; the computed `font-family` of the placeholder was measured in
 * real Chromium on the console's public form page (the PR's Verification).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { HtmlFieldMetadata, MarkdownFieldMetadata, RichtextFieldMetadata } from '@object-ui/types';

import { RichTextField } from '../RichTextField';

const FIELDS: Array<MarkdownFieldMetadata | HtmlFieldMetadata | RichtextFieldMetadata> = [
  { type: 'markdown', name: 'notes', placeholder: 'Describe your request' },
  { type: 'html', name: 'body', placeholder: 'Describe your request' },
  { type: 'richtext', name: 'doc', placeholder: 'Describe your request' },
];

describe('RichTextField — the placeholder takes the sans stack, the source stays mono (#27417)', () => {
  it.each(FIELDS.map((f) => [f.type, f] as const))('%s', (_type, field) => {
    render(<RichTextField value="" onChange={() => {}} field={field} />);
    const box = screen.getByPlaceholderText('Describe your request');
    expect(box).toHaveClass('placeholder:font-sans');
    expect(box).toHaveClass('font-mono');
  });
});
