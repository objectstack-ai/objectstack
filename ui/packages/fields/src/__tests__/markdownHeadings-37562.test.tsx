/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37562 — `drawnMarkdownHeadings` answers the headings the
 * markdown `document` face draws, read from the face's own pipeline, so a
 * reader that must agree with the drawn page counts what is drawn by
 * construction: every shape below is pinned against the face, not against a
 * second markdown reader.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import MarkdownContent from '../widgets/MarkdownContent';
import { drawnMarkdownHeadings } from '../widgets/markdownHeadings';
import { loadDrawnMarkdownHeadings } from '../index';

const texts = (value: string): string[] => drawnMarkdownHeadings(value).map((h) => h.text);

/** What the face itself draws, read off the DOM: the reader must answer the same. */
function drawnByFace(value: string): string[] {
  const { container, unmount } = render(React.createElement(MarkdownContent, { value }));
  const out = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => h.textContent ?? '');
  unmount();
  return out;
}

describe('objectstack#37562 — drawnMarkdownHeadings reads the face’s own parse', () => {
  it('answers each heading with its text and where it starts', () => {
    const value = ['# Intro', '', 'x', '', '## Data & *privacy*', '', 'y'].join('\n');
    expect(drawnMarkdownHeadings(value)).toEqual([
      { text: 'Intro', start: 0 },
      { text: 'Data & privacy', start: value.indexOf('## Data') },
    ]);
  });

  it.each([
    ['a setext heading inside a quote', ['> Scope', '> ---'], ['Scope']],
    ['a setext heading under a comment line', ['<!-- note -->', 'Scope', '---'], ['Scope']],
    ['a setext heading under a link definition', ['[a]: https://example.com', 'Scope', '==='], ['Scope']],
    ['a setext heading under indented code', ['    code', 'Scope', '---'], ['Scope']],
    ['an ATX heading in a footnote, with the Footnotes label the section draws', ['x[^1]', '', '[^1]: # Scope'], ['Footnotes', 'Scope']],
    ['an ATX heading behind a quote or a list marker', ['> # Scope', '', '- # Scope'], ['Scope', 'Scope']],
  ])('S1 — %s is drawn, and answered', (_shape, lines, expected) => {
    const value = lines.join('\n');
    expect(texts(value)).toEqual(expected);
    expect(drawnByFace(value)).toEqual(expected);
  });

  it.each([
    ['a raw heading tag', ['<h2>Scope</h2>']],
    ['an indented code line', ['    # Scope']],
    ['a lazy quote line over a rule', ['> Scope', '---']],
    ['fenced code', ['```', 'Scope', '===', '# Scope', '```']],
  ])('N1 — %s draws no heading, and is not answered', (_shape, lines) => {
    const value = lines.join('\n');
    expect(texts(value)).toEqual([]);
    expect(drawnByFace(value)).toEqual([]);
  });

  it('the Footnotes label starts nowhere in the value', () => {
    expect(drawnMarkdownHeadings(['x[^1]', '', '[^1]: y'].join('\n'))).toEqual([{ text: 'Footnotes', start: undefined }]);
  });

  it('the package index loads the same reader', async () => {
    expect(await loadDrawnMarkdownHeadings()).toBe(drawnMarkdownHeadings);
  });
});
