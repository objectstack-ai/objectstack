/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11245 — a doc placed by its own `group` key keeps its place in the
 * book sidebar even when it lives outside the book's package.
 *
 * The framework's `resolveBookTree` places a doc in a group when the doc's own
 * `group` names that group's `key`, with no package scope; only `include` is
 * scoped (to `group.package`, else the book's package). `GET
 * /meta/book/:name/tree` answers that resolver over every doc. The portal's
 * `scopeDocsToBook` dropped every doc outside the book's packages BEFORE
 * resolving, so a doc the admin placed from the doc editor (objectui#11241)
 * was listed by the endpoint and missing from the sidebar.
 *
 * That pre-filter is retired (objectui#11340): the portal renders the resolver's
 * answer over every doc. The resolver's own orphan pass keeps another package's
 * unplaced docs out of the synthetic Uncategorized group — the controls below
 * hold that — and `include` stays scoped by the resolver itself.
 */

import { describe, it, expect } from 'vitest';
import { resolveBookTree as specResolveBookTree } from '@objectstack/spec/system';
import {
  resolveBookTree,
  countBookDocs,
  type Book,
  type ResolvedBook,
  type ResolverDoc,
} from './book-nav';

const BOOK_PKG = 'com.example.docprobe';
const OTHER_PKG = 'com.example.other';

/** The shape of the card's probe: a book with an `include` group and a `reference` group. */
const book: Book = {
  name: 'docprobe_manual',
  label: 'Probe Manual',
  packageId: BOOK_PKG,
  groups: [
    { key: 'start', label: 'Getting started', order: 1, include: 'docprobe_gs_*' },
    { key: 'reference', label: 'Reference', order: 2, include: 'docprobe_ref_*' },
  ],
};

const docs: ResolverDoc[] = [
  { name: 'docprobe_gs_welcome', label: 'Welcome', packageId: BOOK_PKG },
  // Outside the book's package, placed by its own `group` — one read back with no
  // stamped package, one stamped with a package that is not the book's.
  { name: 'live_guide', label: 'Live Guide', group: 'reference' },
  { name: 'probe_curl', label: 'Probe Curl', group: 'reference', packageId: 'sys_metadata' },
  // Controls: another package's ungrouped doc, and one naming a key this book lacks.
  { name: 'other_note', label: 'Other Note', packageId: OTHER_PKG },
  { name: 'other_stray', label: 'Other Stray', group: 'appendix', packageId: OTHER_PKG },
];

/** What the portal renders for a book: the same call `DocPage` / `BookPage` make, over every doc. */
const portalTree = (b: Book, all: ResolverDoc[]): ResolvedBook => resolveBookTree(b, all);

/** What `GET /meta/book/:name/tree` answers: the spec resolver over every doc, scoped by the book's package. */
const endpointTree = (b: Book, all: ResolverDoc[]) =>
  specResolveBookTree({ name: b.name, label: b.label, groups: b.groups ?? [] }, all, b.packageId);

/** The authored groups only, as `key → [doc…]`. */
const authored = (groups: { key: string; entries: { doc?: string }[] }[]) =>
  groups.filter((g) => g.key !== 'uncategorized').map((g) => ({ key: g.key, docs: g.entries.map((e) => e.doc) }));

const members = (r: ResolvedBook, key: string) => r.groups.find((g) => g.key === key)?.entries.map((e) => e.doc);

describe('objectui#11245 — explicit `group` placement survives the book package scope', () => {
  it('a doc outside the book\'s package that names one of its groups is listed in that group', () => {
    expect(members(portalTree(book, docs), 'reference')).toEqual(['live_guide', 'probe_curl']);
  });

  it('the authored groups equal the tree endpoint\'s answer for the same docs', () => {
    expect(authored(portalTree(book, docs).groups)).toEqual(authored(endpointTree(book, docs).groups));
  });

  it('countBookDocs counts the explicit members', () => {
    expect(countBookDocs(book, docs)).toBe(3); // docprobe_gs_welcome + live_guide + probe_curl
  });

  it('control: another package\'s ungrouped doc, and one naming a key the book lacks, stay out of Uncategorized', () => {
    const tree = portalTree(book, docs);
    const everywhere = tree.groups.flatMap((g) => g.entries.map((e) => e.doc));
    expect(everywhere).not.toContain('other_note');
    expect(everywhere).not.toContain('other_stray');
    expect(tree.groups.some((g) => g.synthetic)).toBe(false);
  });

  it('a group-level `package` override scopes that group\'s `include`, and the explicit member still joins it', () => {
    const scoped: Book = {
      name: 'a_manual',
      label: 'A Manual',
      packageId: 'a',
      groups: [
        { key: 'own', label: 'Own', order: 1, include: '*' },
        { key: 'ext', label: 'Ext', order: 2, include: '*', package: 'b' },
      ],
    };
    const mixed: ResolverDoc[] = [
      { name: 'a_1', packageId: 'a' },
      { name: 'b_1', packageId: 'b' },
      { name: 'c_1', packageId: 'c', group: 'ext' },
      { name: 'c_2', packageId: 'c' },
    ];
    const tree = portalTree(scoped, mixed);
    // The override REPLACES the book's scope for `ext`: `own` takes only package a,
    // `ext` only package b by `include`, and c_1 by its own `group`.
    expect(members(tree, 'own')).toEqual(['a_1']);
    expect(members(tree, 'ext')).toEqual(['b_1', 'c_1']);
    expect(authored(tree.groups)).toEqual(authored(endpointTree(scoped, mixed).groups));
    // c_2 (package c, no `group`) stays out, as other packages' ungrouped docs do.
    expect(tree.groups.flatMap((g) => g.entries.map((e) => e.doc))).not.toContain('c_2');
  });
});
