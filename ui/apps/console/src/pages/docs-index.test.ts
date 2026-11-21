/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35424 — the "All documentation" page's grouping and full-text
 * search, as pure readings. The page's integration (the real `DocsIndex`
 * under the docs routes) is pinned in `docs-portal.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { buildBookCards, buildPortalBooks, type Book, type ResolverDoc } from './book-nav';
import { groupBooksByApp, markTerms, plainText, searchDocs, searchTerms, type DocsIndexApp } from './docs-index';

const DOCS: ResolverDoc[] = [
  { name: 'crm_start', label: 'Getting started', packageId: 'app.crm' },
  { name: 'crm_quotes', label: 'Quotes', packageId: 'app.crm.revenue' },
  { name: 'svc_cases', label: 'Cases', packageId: 'app.crm.service' },
  { name: 'setup_overview', label: 'Setup overview', packageId: 'com.objectstack.setup' },
  { name: 'loose_note', label: 'Loose note', packageId: 'acme.tools' },
];
const AUTHORED: Book[] = [
  { name: 'crm_manual', label: 'User Manual', packageId: 'app.crm', groups: [{ key: 'a', label: 'A', include: 'crm_start' }] },
  { name: 'crm_revenue_manual', label: 'Revenue Manual', packageId: 'app.crm.revenue', groups: [{ key: 'a', label: 'A', include: 'crm_quotes' }] },
  { name: 'crm_service_manual', label: 'Service Manual', packageId: 'app.crm.service', groups: [{ key: 'a', label: 'A', include: 'svc_*' }] },
];
const BOOKS = buildPortalBooks(AUTHORED, DOCS);
const CARDS = buildBookCards(BOOKS, DOCS);

const SALES: DocsIndexApp = {
  name: 'crm_enterprise',
  label: 'Sales',
  _packageId: 'app.crm',
  // The revenue module contributes its manual into the Sales app's navigation.
  navigation: [{ type: 'group', children: [{ type: 'doc', book: 'crm_revenue_manual' }] }],
};
const SERVICE: DocsIndexApp = { name: 'crm_service', label: 'Service', _packageId: 'app.crm.service', navigation: [] };
const SETUP: DocsIndexApp = { name: 'setup', label: 'System Settings', _packageId: 'com.objectstack.setup', navigation: [] };

const shape = (apps: DocsIndexApp[]) =>
  groupBooksByApp(BOOKS, CARDS, DOCS, apps).map((g) => [g.label, g.cards.map((c) => c.label)]);

describe('groupBooksByApp (objectstack#35424)', () => {
  it('a book goes under the app linking it, else its package\'s app, else the ungrouped group', () => {
    expect(shape([SALES, SERVICE])).toEqual([
      ['Sales', ['Revenue Manual', 'User Manual']],
      ['Service', ['Service Manual']],
      [null, ['Tools']],
    ]);
  });

  it('a link to one of the book\'s articles (a `doc` entry) counts as linking the book', () => {
    const service = { ...SERVICE, _packageId: 'other.pkg', areas: [{ navigation: [{ type: 'doc', doc: 'svc_cases' }] }] };
    expect(shape([SALES, service])[1]).toEqual(['Service', ['Service Manual']]);
  });

  it('a platform package\'s book is listed only under its app; with no such app in the list it is not listed', () => {
    expect(shape([SALES, SERVICE]).flatMap(([, cards]) => cards)).not.toContain('Setup');
    // Platform apps' groups come after the business apps'; the implicit book is named by its app.
    expect(shape([SETUP, SALES, SERVICE])).toEqual([
      ['Sales', ['Revenue Manual', 'User Manual']],
      ['Service', ['Service Manual']],
      ['System Settings', ['System Settings']],
      [null, ['Tools']],
    ]);
  });

  it('a platform book an app in the list links is listed under that app, never under the ungrouped group', () => {
    const linking = { ...SALES, navigation: [{ type: 'doc', book: 'com.objectstack.setup' }] };
    expect(shape([linking])).toEqual([
      ['Sales', ['User Manual', 'Setup']],
      [null, ['Revenue Manual', 'Service Manual', 'Tools']],
    ]);
    // With its own app in the list too, it keeps that app's name under the app linking it.
    expect(shape([linking, SETUP])[0]).toEqual(['Sales', ['User Manual', 'System Settings']]);
  });

  it('no card carries the package id line', () => {
    const groups = groupBooksByApp(BOOKS, CARDS, DOCS, [SETUP, SALES]);
    for (const g of groups) for (const c of g.cards) expect(c.subtitle).toBeUndefined();
    // CONTROL: the implicit book's card did carry it before the grouping.
    expect(CARDS.find((c) => c.name === 'acme.tools')?.subtitle).toBe('acme.tools');
  });
});

describe('the full-text search (objectstack#35424)', () => {
  const listed = new Map(CARDS.map((c) => [c.name, c.label] as const));
  const SEARCHABLE = [
    { name: 'crm_start', label: 'Getting started', content: '# Welcome\n\nSign in, then open **Leads**.', packageId: 'app.crm' },
    { name: 'crm_quotes', label: 'Quotes', description: 'Leads become quotes', content: 'A quote expires after 30 days.', packageId: 'app.crm.revenue' },
    {
      name: 'svc_cases',
      label: 'Leads of a case',
      content: '```mermaid\ngraph TD; leads-->x\n```\nCases route by SLA.',
      packageId: 'app.crm.service',
    },
    { name: 'setup_overview', label: 'Setup overview', content: 'Leads permission sets', packageId: 'com.objectstack.setup' },
  ];

  it('needs every word, ranks title over summary over body, and links the article in its own book', () => {
    const hits = searchDocs('leads', SEARCHABLE, BOOKS, DOCS, listed);
    expect(hits.map((h) => h.doc)).toEqual(['svc_cases', 'crm_quotes', 'crm_start', 'setup_overview']);
    expect(hits[0]).toMatchObject({ bookSlug: 'crm_service_manual', bookLabel: 'Service Manual' });
    expect(searchDocs('quote 30', SEARCHABLE, BOOKS, DOCS, listed).map((h) => h.doc)).toEqual(['crm_quotes']);
    expect(searchDocs('quote nowhere', SEARCHABLE, BOOKS, DOCS, listed)).toEqual([]);
    expect(searchDocs('   ', SEARCHABLE, BOOKS, DOCS, listed)).toEqual([]);
  });

  it('answers no article of a book the page does not list', () => {
    const withoutSetup = new Map([...listed].filter(([b]) => b !== 'com.objectstack.setup'));
    expect(searchDocs('permission', SEARCHABLE, BOOKS, DOCS, withoutSetup)).toEqual([]);
    expect(searchDocs('permission', SEARCHABLE, BOOKS, DOCS, listed).map((h) => h.doc)).toEqual(['setup_overview']);
  });

  it('names a hit\'s book as the page\'s card does: an implicit book by its app, not its package', () => {
    const groups = groupBooksByApp(BOOKS, CARDS, DOCS, [SETUP, SALES, SERVICE]);
    const asListed = new Map(groups.flatMap((g) => g.cards.map((c) => [c.name, c.label] as const)));
    const [hit] = searchDocs('permission', SEARCHABLE, BOOKS, DOCS, asListed);
    expect(hit).toMatchObject({ doc: 'setup_overview', bookLabel: 'System Settings' });
    // CONTROL: the book's own label is its package's humanized id.
    expect(BOOKS.find((b) => b.name === 'com.objectstack.setup')?.label).not.toBe('System Settings');
  });

  it('answers every match, so the page\'s count is the true count', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `crm_note_${i}`, label: `Leads note ${i}`, packageId: 'app.crm' }));
    const manyDocs: ResolverDoc[] = many.map((d) => ({ name: d.name, label: d.label, packageId: d.packageId }));
    const books = buildPortalBooks([], manyDocs);
    const asListed = new Map(buildBookCards(books, manyDocs).map((c) => [c.name, c.label] as const));
    expect(searchDocs('leads', many, books, manyDocs, asListed)).toHaveLength(60);
    // CONTROL: an explicit limit still caps the answer.
    expect(searchDocs('leads', many, books, manyDocs, asListed, 5)).toHaveLength(5);
  });

  it('searches the words a reader sees: no diagram source, no markup', () => {
    expect(searchDocs('graph', SEARCHABLE, BOOKS, DOCS, listed)).toEqual([]);
    expect(plainText('## Title\n\nSee [the guide](/docs/x) and `code` **bold** <b>tag</b>')).toBe('Title See the guide and code bold tag');
  });

  it('marks each match in the snippet, case-insensitively, and matches CJK text without spaces', () => {
    expect(markTerms('Open Leads, then leads', ['leads'])).toEqual([
      { text: 'Open ', match: false },
      { text: 'Leads', match: true },
      { text: ', then ', match: false },
      { text: 'leads', match: true },
    ]);
    const zh = [{ name: 'crm_quotes', label: '报价单', content: '报价单生成后三十天过期。', packageId: 'app.crm.revenue' }];
    const [hit] = searchDocs('过期', zh, BOOKS, DOCS, listed);
    expect(hit.snippet.filter((p) => p.match).map((p) => p.text)).toEqual(['过期']);
    expect(searchTerms(' A  b ')).toEqual(['a', 'b']);
  });
});
