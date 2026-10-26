/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { extractToc } from './toc';

describe('extractToc (ADR-0046 long-doc TOC)', () => {
  it('extracts h2/h3 with rehype-slug-compatible ids', () => {
    const toc = extractToc('# Title\n\n## First Section\n\n### Sub A\n\n## Second\n');
    expect(toc).toEqual([
      { depth: 2, text: 'First Section', id: 'first-section' },
      { depth: 3, text: 'Sub A', id: 'sub-a' },
      { depth: 2, text: 'Second', id: 'second' },
    ]);
  });

  it('excludes h1 and h4+ by default', () => {
    const toc = extractToc('# H1\n\n## H2\n\n#### H4\n');
    expect(toc.map((t) => t.depth)).toEqual([2]);
  });

  it('skips headings inside fenced code blocks', () => {
    const toc = extractToc('## Real\n\n```\n## Not A Heading\n```\n\n~~~\n### Also Not\n~~~\n');
    expect(toc.map((t) => t.text)).toEqual(['Real']);
  });

  it('strips inline markdown from heading text', () => {
    const toc = extractToc('## The **overlay** `rule` and a [link](/x)\n');
    expect(toc[0]).toEqual({ depth: 2, text: 'The overlay rule and a link', id: 'the-overlay-rule-and-a-link' });
  });

  it('matches duplicate-heading suffixes like rehype-slug (shared slugger over all headings)', () => {
    // the h1 also advances the slugger, exactly as rehype-slug does
    const toc = extractToc('# Setup\n\n## Setup\n\n## Setup\n');
    expect(toc.map((t) => t.id)).toEqual(['setup-1', 'setup-2']);
  });

  it('returns [] for empty / heading-free content', () => {
    expect(extractToc('')).toEqual([]);
    expect(extractToc('just a paragraph\n')).toEqual([]);
  });
});
