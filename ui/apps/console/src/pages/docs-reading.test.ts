/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35424 — the reader's reading order (previous / next article),
 * the docs column's title filter, and which heading "On this page" marks.
 */

import { describe, it, expect } from 'vitest';
import { articleNeighbours, bookArticles, filterBookArticles } from './docs-reading';
import { ACTIVE_HEADING_OFFSET, pickActiveHeading } from './useActiveHeading';
import type { ResolvedBook } from './book-nav';

const BOOK: ResolvedBook = {
  name: 'revenue',
  label: 'Revenue',
  groups: [
    {
      key: 'quotes',
      label: 'Quotes',
      entries: [
        { doc: 'quotes', label: 'Quotes — generation and expiry', description: 'How a quote is priced' },
        { separator: true },
        { href: 'https://example.com', label: 'External' },
        { doc: 'products', label: 'Products and price books' },
      ],
    },
    {
      key: 'billing',
      label: 'Billing',
      entries: [
        { doc: 'billing', label: 'Billing hand-off' },
        // A doc placed twice keeps its first place.
        { doc: 'quotes', label: 'Quotes — generation and expiry' },
      ],
    },
  ],
};

describe('bookArticles / articleNeighbours', () => {
  it('lists the docs in reading order, once each, without links or separators', () => {
    expect(bookArticles(BOOK).map((a) => a.doc)).toEqual(['quotes', 'products', 'billing']);
  });

  it('answers the articles on either side, across groups', () => {
    const { previous, next } = articleNeighbours(BOOK, 'products');
    expect(previous?.doc).toBe('quotes');
    expect(next?.doc).toBe('billing');
  });

  it('answers null at the ends and for a doc the book does not hold', () => {
    expect(articleNeighbours(BOOK, 'quotes').previous).toBeNull();
    expect(articleNeighbours(BOOK, 'billing').next).toBeNull();
    expect(articleNeighbours(BOOK, 'elsewhere')).toEqual({ previous: null, next: null });
  });
});

describe('filterBookArticles', () => {
  it('keeps the book unchanged for a blank query', () => {
    expect(filterBookArticles(BOOK, '  ')).toBe(BOOK);
  });

  it('matches a title or a summary, case-insensitively, and drops empty groups', () => {
    const byTitle = filterBookArticles(BOOK, 'PRICE');
    expect(byTitle.groups.map((g) => g.key)).toEqual(['quotes']);
    expect(byTitle.groups[0].entries.map((e) => e.doc)).toEqual(['products']);
    const bySummary = filterBookArticles(BOOK, 'priced');
    expect(bySummary.groups[0].entries.map((e) => e.doc)).toEqual(['quotes']);
  });

  it('never keeps a separator or an external link', () => {
    const all = filterBookArticles(BOOK, 'e');
    expect(all.groups.flatMap((g) => g.entries).every((e) => !!e.doc && !e.separator)).toBe(true);
  });

  it('matches a non-Latin title', () => {
    const zh: ResolvedBook = { name: 'b', groups: [{ key: 'g', label: 'G', entries: [{ doc: 'q', label: '报价单——生成与过期' }] }] };
    expect(filterBookArticles(zh, '报价').groups).toHaveLength(1);
  });
});

describe('pickActiveHeading', () => {
  const tops = [
    { id: 'a', top: 40 },
    { id: 'b', top: 110 },
    { id: 'c', top: 600 },
  ];

  it('is the last heading at or above the offset', () => {
    expect(pickActiveHeading(tops, ACTIVE_HEADING_OFFSET, false)).toBe('b');
  });

  it('is the first heading before any reaches the offset', () => {
    expect(pickActiveHeading([{ id: 'a', top: 300 }, { id: 'b', top: 900 }], ACTIVE_HEADING_OFFSET, false)).toBe('a');
  });

  it('is the last heading once the page is scrolled to its end', () => {
    expect(pickActiveHeading(tops, ACTIVE_HEADING_OFFSET, true)).toBe('c');
  });

  it('is null with no headings', () => {
    expect(pickActiveHeading([], ACTIVE_HEADING_OFFSET, false)).toBeNull();
  });
});
