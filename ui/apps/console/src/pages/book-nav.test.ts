/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBookTree,
  deriveImplicitPackageBook,
  buildBookCards,
  buildPortalBooks,
  firstDoc,
  homeBook,
  bookSlug,
  pkgOf,
  findBookContainingDoc,
  sortBooks,
  countEntries,
  type Book,
  type ResolverDoc,
} from './book-nav';

const docs: ResolverDoc[] = [
  { name: 'crm_intro', label: 'Intro', order: 1 },
  { name: 'crm_guide_lead', label: 'Leads', order: 2 },
  { name: 'crm_guide_deal', label: 'Deals', order: 1 },
  { name: 'crm_ref_api', label: 'API' },
  { name: 'misc_note' }, // matched by no rule → Uncategorized
];

describe('resolveBookTree (ADR-0046 §6)', () => {
  it('derives membership from glob include and sorts by order then label', () => {
    const book: Book = {
      name: 'crm_manual',
      label: 'CRM Manual',
      groups: [
        { key: 'start', label: 'Getting started', order: 1, include: 'crm_intro' },
        { key: 'guides', label: 'Guides', order: 2, include: 'crm_guide_*' },
      ],
    };
    const r = resolveBookTree(book, docs);
    expect(r.groups.map((g) => g.key)).toEqual(['start', 'guides', 'uncategorized']);
    // guides sorted by order: deal(1) before lead(2)
    expect(r.groups[1].entries.map((e) => e.doc)).toEqual(['crm_guide_deal', 'crm_guide_lead']);
  });

  it('a book that declares no package drops nothing — unmatched docs fall into Uncategorized last', () => {
    const book: Book = { name: 'b', groups: [{ key: 'g', label: 'G', include: 'crm_guide_*' }] };
    const r = resolveBookTree(book, docs);
    const uncategorized = r.groups.find((g) => g.key === 'uncategorized');
    expect(uncategorized?.entries.map((e) => e.doc)).toContain('misc_note');
    expect(uncategorized?.entries.map((e) => e.doc)).toContain('crm_intro');
  });

  it('first matching group wins — a doc is never duplicated across groups', () => {
    const book: Book = {
      name: 'b',
      groups: [
        { key: 'all', label: 'All', order: 1, include: 'crm_*' },
        { key: 'guides', label: 'Guides', order: 2, include: 'crm_guide_*' },
      ],
    };
    const r = resolveBookTree(book, docs);
    expect(r.groups[1].entries).toHaveLength(0); // everything already claimed by 'all'
  });

  it('honours a tag include rule', () => {
    const tagged: ResolverDoc[] = [{ name: 'd1', tags: ['start'] }, { name: 'd2' }];
    const book: Book = { name: 'b', groups: [{ key: 'g', label: 'G', include: { tag: 'start' } }] };
    const r = resolveBookTree(book, tagged);
    expect(r.groups[0].entries.map((e) => e.doc)).toEqual(['d1']);
  });

  it('explicit pages override: verbatim order, --- separator, badge, external link, ... rest', () => {
    const book: Book = {
      name: 'b',
      groups: [
        {
          key: 'curated',
          label: 'Curated',
          include: 'crm_guide_*',
          pages: [
            'crm_intro',
            '---',
            { doc: 'crm_guide_lead', label: 'Lead mgmt', badge: 'new' },
            { href: 'https://example.com', label: 'External' },
            '...', // expands to the remaining crm_guide_* (i.e. crm_guide_deal)
          ],
        },
      ],
    };
    const r = resolveBookTree(book, docs);
    const e = r.groups[0].entries;
    expect(e[0].doc).toBe('crm_intro');
    expect(e[1].separator).toBe(true);
    expect(e[2]).toMatchObject({ doc: 'crm_guide_lead', label: 'Lead mgmt', badge: 'new' });
    expect(e[3]).toMatchObject({ href: 'https://example.com', label: 'External' });
    expect(e[4].doc).toBe('crm_guide_deal'); // the rest
  });

  it('scopes include to a package when group.package / bookPackage is set', () => {
    const mixed: ResolverDoc[] = [
      { name: 'a_x', packageId: 'a' },
      { name: 'b_x', packageId: 'b' },
    ];
    const book: Book = { name: 'bk', groups: [{ key: 'g', label: 'G', include: '*', package: 'a' }] };
    const r = resolveBookTree(book, mixed);
    expect(r.groups[0].entries.map((e) => e.doc)).toEqual(['a_x']);
    // b_x is in no group, and package b is none of this book's packages, so it is
    // not this book's orphan either: no Uncategorized group (objectui#11340)
    expect(r.groups.map((g) => g.key)).toEqual(['g']);
  });
});

describe('deriveImplicitPackageBook', () => {
  it("includes only the package's own docs (scoped by name prefix when unstamped)", () => {
    const book = deriveImplicitPackageBook('crm', 'CRM');
    const r = resolveBookTree(book, docs);
    expect(r.groups[0].key).toBe('all');
    const inAll = r.groups[0].entries.map((e) => e.doc);
    // The four crm_* docs land in the implicit crm book...
    expect(inAll).toHaveLength(4);
    expect(inAll).toEqual(expect.arrayContaining(['crm_intro', 'crm_guide_lead', 'crm_guide_deal', 'crm_ref_api']));
    // ...and misc_note (package 'misc') does not.
    expect(inAll).not.toContain('misc_note');
  });
});

describe('buildPortalBooks (ADR-0046 §6.4 — no flat/book fork)', () => {
  it('synthesizes an implicit per-package book for packages without an authored one', () => {
    const authored: Book[] = [
      { name: 'crm_manual', label: 'CRM Manual', groups: [{ key: 'g', label: 'G', include: 'crm_guide_*' }] },
    ];
    const portal = buildPortalBooks(authored, docs);
    // crm has an authored book (pkg 'crm'); misc only has the implicit one.
    expect(portal.map((b) => b.name)).toContain('crm_manual');
    expect(portal.map((b) => b.name)).toContain('misc'); // implicit book keyed by packageId
    // no duplicate implicit 'crm' book, since crm_manual already owns 'crm'
    expect(portal.filter((b) => b.name === 'crm').length).toBe(0);
    // authored books lead, implicit ones follow
    expect(portal[0].name).toBe('crm_manual');
    expect(portal[portal.length - 1].name).toBe('misc');
    // implicit label is humanized, not the raw package id
    const misc = portal.find((b) => b.name === 'misc');
    expect(misc?.label).toBe('Misc');
    expect(misc?.implicit).toBe(true); // synthetic books are flagged
  });

  it('cards surface the package id as a subtitle for implicit books only', () => {
    const authored: Book[] = [
      { name: 'crm_manual', label: 'CRM Manual', description: 'd', groups: [{ key: 'g', label: 'G', include: 'crm_*' }] },
    ];
    const cards = buildBookCards(buildPortalBooks(authored, docs), docs);
    expect(cards.find((c) => c.name === 'crm_manual')?.subtitle).toBeUndefined(); // authored: has a description
    expect(cards.find((c) => c.name === 'misc')?.subtitle).toBe('misc'); // implicit: package id
  });

  it('with no authored books, every package becomes its own implicit book', () => {
    const portal = buildPortalBooks([], docs);
    expect(portal.map((b) => b.name).sort()).toEqual(['crm', 'misc']);
  });
});

describe('homeBook + bookSlug', () => {
  it('resolves a doc to its package book and exposes its url slug', () => {
    const portal = buildPortalBooks([], docs);
    const hb = homeBook('crm_intro', portal, docs);
    expect(hb?.name).toBe('crm');
    expect(bookSlug(hb!)).toBe('crm');
  });

  it('prefers an authored book over the implicit one as a doc\'s home', () => {
    const authored: Book[] = [
      { name: 'crm_manual', slug: 'manual', label: 'CRM Manual', groups: [{ key: 'g', label: 'G', include: 'crm_*' }] },
    ];
    const portal = buildPortalBooks(authored, docs);
    const hb = homeBook('crm_intro', portal, docs);
    expect(hb?.name).toBe('crm_manual');
    expect(bookSlug(hb!)).toBe('manual'); // explicit slug wins over name
  });

  it('pkgOf falls back to the name prefix when unstamped', () => {
    expect(pkgOf({ name: 'crm_intro' })).toBe('crm');
    expect(pkgOf({ name: 'crm_intro', packageId: 'override' })).toBe('override');
  });
});

describe('portal helpers', () => {
  it('sortBooks orders by order then label then index', () => {
    const books: Book[] = [
      { name: 'z', label: 'Z', order: 2 },
      { name: 'a', label: 'A', order: 1 },
      { name: 'b', label: 'B', order: 1 },
    ];
    expect(sortBooks(books).map((b) => b.name)).toEqual(['a', 'b', 'z']);
  });

  it('buildBookCards reports a deduped doc count', () => {
    const books: Book[] = [
      { name: 'm', label: 'Manual', groups: [{ key: 'g', label: 'G', include: 'crm_*' }] },
    ];
    const [card] = buildBookCards(books, docs);
    expect(card.label).toBe('Manual');
    expect(card.slug).toBe('m'); // no explicit slug → falls back to the book name
    expect(card.docCount).toBe(4); // the four crm_* docs
  });

  it('findBookContainingDoc returns the first book whose tree holds the doc', () => {
    const books: Book[] = [
      { name: 'guides', label: 'Guides', order: 1, groups: [{ key: 'g', label: 'G', include: 'crm_guide_*' }] },
      { name: 'all', label: 'All', order: 2, groups: [{ key: 'a', label: 'A', include: 'crm_*' }] },
    ];
    const hit = findBookContainingDoc(books, docs, 'crm_guide_lead');
    expect(hit?.book.name).toBe('guides');
    expect(findBookContainingDoc(books, docs, 'nonexistent')).toBeNull();
  });

  it('a doc that only lands in a book\'s synthetic Uncategorized is NOT owned by it', () => {
    // 'misc_note' matches neither book's rule → only ever in Uncategorized.
    const books: Book[] = [
      { name: 'guides', label: 'Guides', groups: [{ key: 'g', label: 'G', include: 'crm_guide_*' }] },
    ];
    expect(findBookContainingDoc(books, docs, 'misc_note')).toBeNull();
  });

  it('firstDoc prefers an *_index doc, else the first in reading order', () => {
    const withIndex = resolveBookTree(
      { name: 'b', groups: [{ key: 'g', label: 'G', include: 'crm_*' }] },
      [
        { name: 'crm_guide_lead', order: 1 },
        { name: 'crm_index', order: 9 }, // later in order, but the index wins
      ],
    );
    expect(firstDoc(withIndex)).toBe('crm_index');

    const noIndex = resolveBookTree(
      { name: 'b', groups: [{ key: 'g', label: 'G', include: 'crm_*' }] },
      [{ name: 'crm_b', order: 2 }, { name: 'crm_a', order: 1 }],
    );
    expect(firstDoc(noIndex)).toBe('crm_a'); // first by order

    // A book with no readable docs → undefined.
    expect(firstDoc({ name: 'b', label: 'B', groups: [] })).toBeUndefined();
  });

  it('countEntries ignores separators', () => {
    const groups = [
      { key: 'g', label: 'G', entries: [{ doc: 'a' }, { separator: true }, { href: 'x' }] },
    ];
    expect(countEntries(groups)).toBe(2);
  });
});
