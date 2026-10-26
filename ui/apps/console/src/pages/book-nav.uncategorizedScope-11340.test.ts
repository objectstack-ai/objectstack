/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11340 — the book's synthetic Uncategorized group holds only the
 * unplaced docs of the book's own packages (the book's, and each group's
 * `package`), and the portal renders that answer with no pre-filter in front.
 *
 * The framework's `resolveBookTree` scopes its orphan pass that way since
 * objectstack#20980 (`@objectstack/spec` 17.6.0). The portal's resolver is a
 * local port of it; until this card the port's orphan pass was unscoped, and the
 * portal narrowed the doc set before resolving (`scopeDocsToBook`) to make up for
 * it. That second authority is retired; the port's orphan pass now scopes.
 *
 * Each case below states the portal's answer AND checks it against the spec's
 * resolver over the same docs, scoped by the book's package — what `GET
 * /meta/book/:name/tree` answers. Every fixture doc carries a `packageId`, the
 * `_packageId` stamp the server reads for the same test.
 */

import { describe, it, expect } from 'vitest';
import { resolveBookTree as specResolveBookTree } from '@objectstack/spec/system';
import { resolveBookTree, countBookDocs, type Book, type ResolvedBook, type ResolverDoc } from './book-nav';

/** What `GET /meta/book/:name/tree` answers: the spec resolver, scoped by the book's package. */
const endpointTree = (b: Book, all: ResolverDoc[]) =>
  specResolveBookTree({ name: b.name, label: b.label, groups: b.groups ?? [] }, all, b.packageId);

/** Every group, authored and synthetic, as `{ key, label, entries }` (the portal-only flag dropped). */
const groupsOf = (r: { groups: { key: string; label: string; entries: unknown[] }[] }) =>
  r.groups.map((g) => ({ key: g.key, label: g.label, entries: g.entries }));

const members = (r: ResolvedBook, key: string) => r.groups.find((g) => g.key === key)?.entries.map((e) => e.doc);
const everywhere = (r: ResolvedBook) => r.groups.flatMap((g) => g.entries.map((e) => e.doc));

describe('objectui#11340 — Uncategorized holds only the book\'s own packages\' unplaced docs', () => {
  const book: Book = {
    name: 'crm_manual',
    label: 'CRM Manual',
    packageId: 'crm',
    groups: [{ key: 'start', label: 'Getting started', include: 'crm_intro' }],
  };
  const docs: ResolverDoc[] = [
    { name: 'crm_intro', label: 'Intro', packageId: 'crm' },
    { name: 'crm_stray', label: 'Stray', packageId: 'crm' },
    { name: 'ops_keys', label: 'Keys', packageId: 'ops' },
  ];

  it('another package\'s ungrouped doc is absent; the book\'s own ungrouped doc is present (the control)', () => {
    const tree = resolveBookTree(book, docs);
    expect(members(tree, 'uncategorized')).toEqual(['crm_stray']);
    expect(everywhere(tree)).not.toContain('ops_keys');
    expect(groupsOf(tree)).toEqual(groupsOf(endpointTree(book, docs)));
  });

  it('a book that declares no package keeps every unclaimed doc', () => {
    const unscoped: Book = { name: 'manual', groups: book.groups };
    // Ordered by label: Keys, then Stray.
    expect(members(resolveBookTree(unscoped, docs), 'uncategorized')).toEqual(['ops_keys', 'crm_stray']);
    expect(groupsOf(resolveBookTree(unscoped, docs))).toEqual(groupsOf(endpointTree(unscoped, docs)));
  });

  it('corner 1: a group\'s `package` makes that package\'s unplaced docs the book\'s orphans too', () => {
    const scoped: Book = {
      name: 'a_manual',
      packageId: 'a',
      groups: [
        { key: 'own', label: 'Own', order: 1, include: 'a_*' },
        { key: 'ext', label: 'Ext', order: 2, include: 'b_ref_*', package: 'b' },
      ],
    };
    const mixed: ResolverDoc[] = [
      { name: 'a_1', packageId: 'a' },
      { name: 'b_ref_1', packageId: 'b' },
      { name: 'b_note', packageId: 'b' },
      { name: 'c_note', packageId: 'c' },
    ];
    const tree = resolveBookTree(scoped, mixed);
    expect(members(tree, 'ext')).toEqual(['b_ref_1']);
    expect(members(tree, 'uncategorized')).toEqual(['b_note']);
    expect(everywhere(tree)).not.toContain('c_note');
    expect(groupsOf(tree)).toEqual(groupsOf(endpointTree(scoped, mixed)));
  });

  it('corner 2: a `pages`-pinned doc of another package is listed where the pin places it, as that doc', () => {
    const pinned: Book = {
      ...book,
      groups: [{ key: 'pinned', label: 'Pinned', pages: ['crm_intro', 'ops_keys'] }],
    };
    const tree = resolveBookTree(pinned, docs);
    expect(tree.groups[0].entries).toEqual([
      { doc: 'crm_intro', label: 'Intro', description: undefined },
      { doc: 'ops_keys', label: 'Keys', description: undefined },
    ]);
    expect(members(tree, 'uncategorized')).toEqual(['crm_stray']);
    expect(countBookDocs(pinned, docs)).toBe(2);
    expect(groupsOf(tree)).toEqual(groupsOf(endpointTree(pinned, docs)));
  });

  it('a book with no package of its own and a group `package` lets its unscoped `include` read every package', () => {
    const noOwn: Book = {
      name: 'manual',
      groups: [
        { key: 'all', label: 'All', order: 1, include: '*' },
        { key: 'ext', label: 'Ext', order: 2, include: 'b_ref_*', package: 'b' },
      ],
    };
    const mixed: ResolverDoc[] = [
      { name: 'a_1', packageId: 'a' },
      { name: 'b_1', packageId: 'b' },
    ];
    const tree = resolveBookTree(noOwn, mixed);
    expect(members(tree, 'all')).toEqual(['a_1', 'b_1']);
    expect(groupsOf(tree)).toEqual(groupsOf(endpointTree(noOwn, mixed)));
  });

  it('another package\'s doc naming a `pages` group that collects nothing by key is in no group of the book', () => {
    const pinned: Book = { ...book, groups: [{ key: 'pinned', label: 'Pinned', pages: ['crm_intro'] }] };
    const withForeign: ResolverDoc[] = [...docs, { name: 'ops_named', packageId: 'ops', group: 'pinned' }];
    const tree = resolveBookTree(pinned, withForeign);
    expect(everywhere(tree)).not.toContain('ops_named');
    expect(groupsOf(tree)).toEqual(groupsOf(endpointTree(pinned, withForeign)));
  });
});
