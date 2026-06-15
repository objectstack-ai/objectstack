// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  BookSchema,
  resolveBookTree,
  deriveImplicitPackageBook,
  isPublicAudience,
  type Book,
  type ResolverDoc,
} from './book.zod';

const docs = (names: string[]): ResolverDoc[] => names.map((name) => ({ name }));

describe('BookSchema (ADR-0046 §6)', () => {
  it('accepts a minimal spine', () => {
    expect(() =>
      BookSchema.parse({ name: 'crm_guide', groups: [{ key: 'start', label: 'Start', include: 'crm_*' }] }),
    ).not.toThrow();
  });
  it('rejects a non snake_case name', () => {
    expect(() => BookSchema.parse({ name: 'CrmGuide', groups: [] })).toThrow();
  });
  it('rejects a non snake_case group key', () => {
    expect(() => BookSchema.parse({ name: 'crm_guide', groups: [{ key: 'Start', label: 'x' }] })).toThrow();
  });
  it('accepts audience variants', () => {
    for (const audience of ['org', 'public', { profile: 'admin' }] as const) {
      expect(() => BookSchema.parse({ name: 'b', audience, groups: [] })).not.toThrow();
    }
  });
});

describe('resolveBookTree — derived membership (the AI-safety core)', () => {
  it('derives membership by glob include, leaving docs untouched', () => {
    const book: Book = {
      name: 'crm',
      groups: [
        { key: 'guides', label: 'Guides', include: 'crm_guide_*' },
        { key: 'ref', label: 'Reference', include: 'crm_ref_*' },
      ],
    };
    const tree = resolveBookTree(book, docs(['crm_guide_lead', 'crm_guide_deal', 'crm_ref_api']));
    expect(tree.groups.map((g) => g.key)).toEqual(['guides', 'ref']);
    expect(tree.groups[0].entries.map((e) => e.doc)).toEqual(['crm_guide_deal', 'crm_guide_lead']); // alpha
    expect(tree.groups[1].entries.map((e) => e.doc)).toEqual(['crm_ref_api']);
  });

  it('a NEW doc matching a rule appears with zero edits to the book (create-and-forget)', () => {
    const book: Book = { name: 'crm', groups: [{ key: 'guides', label: 'Guides', include: 'crm_guide_*' }] };
    const before = resolveBookTree(book, docs(['crm_guide_lead']));
    expect(before.groups[0].entries).toHaveLength(1);
    // AI adds crm_guide_deal — same unchanged book spine:
    const after = resolveBookTree(book, docs(['crm_guide_lead', 'crm_guide_deal']));
    expect(after.groups[0].entries.map((e) => e.doc)).toEqual(['crm_guide_deal', 'crm_guide_lead']);
  });

  it('sorts within a group by doc.order then label', () => {
    const book: Book = { name: 'crm', groups: [{ key: 'g', label: 'G', include: '*' }] };
    const tree = resolveBookTree(book, [
      { name: 'b_doc', order: 2 },
      { name: 'a_doc', order: 1 },
      { name: 'z_doc' }, // order 0 → first
    ]);
    expect(tree.groups[0].entries.map((e) => e.doc)).toEqual(['z_doc', 'a_doc', 'b_doc']);
  });

  it('honours explicit doc.group placement', () => {
    const book: Book = {
      name: 'crm',
      groups: [
        { key: 'guides', label: 'Guides', include: 'never_*' },
        { key: 'admin', label: 'Admin' },
      ],
    };
    const tree = resolveBookTree(book, [{ name: 'setup', group: 'admin' }]);
    expect(tree.groups.find((g) => g.key === 'admin')!.entries.map((e) => e.doc)).toEqual(['setup']);
  });

  it('routes unmatched docs to a synthetic Uncategorized group, never dropping them', () => {
    const book: Book = { name: 'crm', groups: [{ key: 'guides', label: 'Guides', include: 'crm_guide_*' }] };
    const tree = resolveBookTree(book, docs(['crm_guide_lead', 'crm_stray', 'crm_other']));
    const unc = tree.groups.at(-1)!;
    expect(unc.key).toBe('uncategorized');
    expect(unc.entries.map((e) => e.doc)).toEqual(['crm_other', 'crm_stray']);
  });

  it('first group (by order) wins when two rules match the same doc — no duplicates', () => {
    const book: Book = {
      name: 'crm',
      groups: [
        { key: 'second', label: 'Second', order: 2, include: 'crm_*' },
        { key: 'first', label: 'First', order: 1, include: 'crm_*' },
      ],
    };
    const tree = resolveBookTree(book, docs(['crm_x']));
    expect(tree.groups.map((g) => g.key)).toEqual(['first', 'second']);
    expect(tree.groups[0].entries.map((e) => e.doc)).toEqual(['crm_x']);
    expect(tree.groups[1].entries).toHaveLength(0);
  });

  it('explicit pages override: verbatim order, separator, missing doc, and ... rest', () => {
    const book: Book = {
      name: 'crm',
      groups: [
        {
          key: 'tut',
          label: 'Tutorial',
          include: 'crm_tut_*',
          pages: ['crm_tut_intro', '---', 'crm_tut_missing', '...'],
        },
      ],
    };
    const tree = resolveBookTree(book, docs(['crm_tut_intro', 'crm_tut_b', 'crm_tut_a']));
    const e = tree.groups[0].entries;
    expect(e[0]).toMatchObject({ doc: 'crm_tut_intro' });
    expect(e[1]).toMatchObject({ separator: true });
    expect(e[2]).toMatchObject({ doc: 'crm_tut_missing' }); // missing → renderer shows not-found
    // '...' sweeps the rest of this group's matches, not the pinned intro:
    expect(e.slice(3).map((x) => x.doc)).toEqual(['crm_tut_a', 'crm_tut_b']);
  });

  it('object node carries badge/icon and label override; href node is a link', () => {
    const book: Book = {
      name: 'crm',
      groups: [{ key: 'g', label: 'G', pages: [{ doc: 'crm_api', badge: 'beta' }, { href: 'https://x', label: 'CHANGELOG' }] }],
    };
    const tree = resolveBookTree(book, [{ name: 'crm_api', label: 'API' }]);
    expect(tree.groups[0].entries[0]).toMatchObject({ doc: 'crm_api', badge: 'beta', label: 'API' });
    expect(tree.groups[0].entries[1]).toMatchObject({ href: 'https://x', label: 'CHANGELOG' });
  });

  it('include scoped by package ignores docs from other packages', () => {
    const book: Book = { name: 'crm', groups: [{ key: 'g', label: 'G', include: '*', package: 'crm' }] };
    const tree = resolveBookTree(book, [
      { name: 'a', packageId: 'crm' },
      { name: 'b', packageId: 'other' },
    ]);
    expect(tree.groups[0].entries.map((e) => e.doc)).toEqual(['a']);
    expect(tree.groups.at(-1)!.key).toBe('uncategorized'); // 'b' falls through
  });
});

describe('deriveImplicitPackageBook + audience', () => {
  it('synthesizes a one-group book including every doc of the package', () => {
    const book = deriveImplicitPackageBook('app_todo', 'Todo');
    const tree = resolveBookTree(book, docs(['todo_index', 'todo_guide']));
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0].entries.map((e) => e.doc)).toEqual(['todo_guide', 'todo_index']);
  });
  it('isPublicAudience only true for public', () => {
    expect(isPublicAudience('public')).toBe(true);
    expect(isPublicAudience('org')).toBe(false);
    expect(isPublicAudience({ profile: 'admin' })).toBe(false);
    expect(isPublicAudience(undefined)).toBe(false);
  });
});
