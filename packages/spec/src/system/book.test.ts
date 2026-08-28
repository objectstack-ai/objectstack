// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { z } from 'zod';
import {
  BookSchema,
  resolveBookTree,
  deriveImplicitPackageBook,
  isPublicAudience,
  audienceAllows,
  resolveBookClaimedDocs,
  resolveDocAudiences,
  docAudienceAllows,
  ResolvedEntrySchema,
  ResolvedGroupSchema,
  ResolvedBookSchema,
  type Book,
  type ResolverDoc,
  type ResolvedEntry,
  type ResolvedGroup,
  type ResolvedBook,
} from './book.zod';
import { DocSchema } from './doc.zod';

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
    for (const audience of ['org', 'public', { permissionSet: 'crm_admin' }] as const) {
      expect(() => BookSchema.parse({ name: 'b', audience, groups: [] })).not.toThrow();
    }
  });
  it('rejects the removed { profile } audience shape (ADR-0090 D2)', () => {
    expect(() => BookSchema.parse({ name: 'b', audience: { profile: 'admin' }, groups: [] })).toThrow();
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

  it('derives membership by TAG include — the variant DocSchema.tags finally makes reachable', () => {
    // #4509: the tag branch of `matchesInclude` shipped long before anything
    // could feed it. `DocSchema` is strict and had no `tags` key, so authoring
    // tags was a parse error, every doc arrived with `tags === undefined`, and
    // this variant could not match a single doc in any stack. Declaring
    // `DocSchema.tags` was the whole fix — the matcher, the REST transport and
    // `ResolverDoc.tags` were all already in place.
    const book: Book = {
      name: 'crm',
      groups: [{ key: 'tut', label: 'Tutorials', include: { tag: 'tutorial' } }],
    };
    const tree = resolveBookTree(book, [
      { name: 'crm_guide_lead', tags: ['tutorial'] },
      { name: 'setup_sso', tags: ['tutorial', 'admin'] },
      { name: 'crm_ref_api', tags: ['reference'] },
      { name: 'crm_ref_bare' }, // no tags at all
    ]);
    // Tags cut ACROSS the naming convention — that is the point of the variant:
    // a glob could not have collected these two.
    expect(tree.groups[0].entries.map((e) => e.doc)).toEqual(['crm_guide_lead', 'setup_sso']);
  });

  it('accepts `tags` on an authored doc (the strict schema used to reject it)', () => {
    expect(() => DocSchema.parse({
      name: 'crm_guide_lead',
      content: '# Leads',
      tags: ['tutorial', 'crm'],
    })).not.toThrow();
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
    expect(isPublicAudience({ permissionSet: 'crm_admin' })).toBe(false);
    expect(isPublicAudience(undefined)).toBe(false);
  });
});

describe('audienceAllows (ADR-0046 §6.7, ADR-0090 vocabulary)', () => {
  const anon = { authenticated: false };
  const member = { authenticated: true, permissionSets: ['member_default'] };
  const admin = { authenticated: true, permissionSets: ['member_default', 'crm_admin'] };
  const unresolved = { authenticated: true }; // security resolution unavailable

  it('public allows everyone, including anonymous', () => {
    for (const caller of [anon, member, admin, unresolved]) {
      expect(audienceAllows('public', caller)).toBe(true);
    }
  });
  it('org (and unset) allows any authenticated principal, never anonymous', () => {
    for (const audience of ['org', undefined] as const) {
      expect(audienceAllows(audience, anon)).toBe(false);
      expect(audienceAllows(audience, member)).toBe(true);
      expect(audienceAllows(audience, unresolved)).toBe(true);
    }
  });
  it('permission-set gate requires holding the named set', () => {
    const gated = { permissionSet: 'crm_admin' };
    expect(audienceAllows(gated, admin)).toBe(true);
    expect(audienceAllows(gated, member)).toBe(false);
    expect(audienceAllows(gated, anon)).toBe(false);
  });
  it('permission-set gate FAILS CLOSED when holdings are unknown (ADR-0049)', () => {
    expect(audienceAllows({ permissionSet: 'crm_admin' }, unresolved)).toBe(false);
  });
});

describe('resolveDocAudiences — union over claiming books (§6.7)', () => {
  const corpus: ResolverDoc[] = [
    { name: 'crm_guide_intro', packageId: 'crm' },
    { name: 'crm_guide_flows', packageId: 'crm' },
    { name: 'crm_admin_setup', packageId: 'crm' },
    { name: 'crm_unclaimed', packageId: 'crm' },
  ];
  const publicBook: Book & { packageId?: string } = {
    name: 'crm_guide',
    audience: 'public',
    groups: [{ key: 'g', label: 'Guide', include: 'crm_guide_*' }],
    packageId: 'crm',
  };
  const adminBook: Book & { packageId?: string } = {
    name: 'crm_admin_guide',
    audience: { permissionSet: 'crm_admin' },
    groups: [{ key: 'a', label: 'Admin', include: 'crm_admin_*' }],
    packageId: 'crm',
  };

  it('claimed docs union the audiences of every claiming book', () => {
    const audiences = resolveDocAudiences([publicBook, adminBook], corpus);
    expect(audiences.get('crm_guide_intro')).toEqual(['public']);
    expect(audiences.get('crm_admin_setup')).toEqual([{ permissionSet: 'crm_admin' }]);
  });
  it('a doc claimed by no book defaults to org — orphans do NOT ride along with public books', () => {
    const audiences = resolveDocAudiences([publicBook, adminBook], corpus);
    expect(audiences.get('crm_unclaimed')).toEqual(['org']);
    // The tree view still renders the orphan (nothing is dropped)…
    const tree = resolveBookTree(publicBook, corpus, 'crm');
    expect(tree.groups.at(-1)!.entries.some((e) => e.doc === 'crm_unclaimed')).toBe(true);
    // …but the CLAIM set excludes it, so it never inherits `public`.
    expect(resolveBookClaimedDocs(publicBook, corpus, 'crm').has('crm_unclaimed')).toBe(false);
  });
  it('docAudienceAllows applies the union: any allowing book grants access', () => {
    const both: Book & { packageId?: string } = {
      ...adminBook,
      name: 'crm_all',
      audience: 'org',
      groups: [{ key: 'all', label: 'All', include: 'crm_admin_*' }],
    };
    const audiences = resolveDocAudiences([adminBook, both], corpus);
    const member = { authenticated: true, permissionSets: ['member_default'] };
    // Reachable via the org book even without crm_admin.
    expect(docAudienceAllows(audiences.get('crm_admin_setup'), member)).toBe(true);
    // Gated-only doc stays gated.
    const gatedOnly = resolveDocAudiences([adminBook], corpus);
    expect(docAudienceAllows(gatedOnly.get('crm_admin_setup'), member)).toBe(false);
    expect(docAudienceAllows(gatedOnly.get('crm_admin_setup'), { authenticated: false })).toBe(false);
  });
  it('an unknown doc (absent from the corpus map) gets the org default', () => {
    expect(docAudienceAllows(undefined, { authenticated: true })).toBe(true);
    expect(docAudienceAllows(undefined, { authenticated: false })).toBe(false);
  });
});

// ── Inline translation maps retired in 17.0.0 (#4667, ADR-0049) ─────────────
describe('retired book translation maps (#4667)', () => {
  it('rejects a book-level `translations` map and names the live neighbour', () => {
    // The prescription has to mention `doc.translations`: that key is live on
    // every doc render path and is what the author actually wanted. Without it
    // the rejection reads as "localization is unsupported", which is false.
    const parse = () => BookSchema.parse({
      name: 'crm_guide', label: 'CRM Guide',
      translations: { 'zh-CN': { label: 'CRM 指南' } },
      groups: [{ key: 'basics', label: 'Basics' }],
    });
    expect(parse).toThrow(/translations.*removed.*17\.0\.0/s);
    expect(parse).toThrow(/doc\.translations/s);
  });

  it('rejects the `i18n` alias with the same prescription, not a rename', () => {
    // `i18n` used to alias `translations`. An alias surviving its target would
    // answer "did you mean `translations`?" — a rename onto a key that is gone.
    expect(() => BookSchema.parse({
      name: 'crm_guide', label: 'CRM Guide',
      i18n: { 'zh-CN': { label: 'CRM 指南' } },
      groups: [{ key: 'basics', label: 'Basics' }],
    })).toThrow(/translations.*removed/s);
  });

  it('rejects a GROUP-level `translations` map — the tombstone, not a silent strip', () => {
    // BookGroupSchema is a plain z.object with no .strict(), so this key is
    // TOMBSTONED rather than deleted. Pinning the throw is what proves the
    // tombstone is still there: a plain delete here would make zod strip the
    // key silently and this test would fail with "expected to throw".
    expect(() => BookSchema.parse({
      name: 'crm_guide', label: 'CRM Guide',
      groups: [{ key: 'basics', label: 'Basics', translations: { 'zh-CN': { label: '基础' } } }],
    })).toThrow(/translations.*removed.*17\.0\.0/s);
  });

  it('still accepts a book with no translation map', () => {
    expect(() => BookSchema.parse({
      name: 'crm_guide', label: 'CRM Guide',
      groups: [{ key: 'basics', label: 'Basics', include: 'crm_*' }],
    })).not.toThrow();
  });
});

// ==========================================
// book-tree response contract (#12038)
// ==========================================

describe('ResolvedBookSchema is the book-tree response contract (#12038)', () => {
  // The conformance suite for the `GET /meta/book/:name/tree` ledger rows
  // (#3877's no-row-without-conformance rule). Stronger than the handwritten
  // captures its meta.* siblings use: `resolveBookTree()` is pure and lives in
  // this file's module, so the suite drives the REAL producer and parses what
  // it actually returns.
  const spine: Book = {
    name: 'crm_guide',
    label: 'CRM Guide',
    groups: [
      { key: 'basics', label: 'Basics', include: 'crm_*' },
      { key: 'links', label: 'Links', pages: ['---', { href: 'https://example.com', label: 'Site', badge: 'new' }] },
    ],
  };
  const resolverDocs: ResolverDoc[] = [
    { name: 'crm_intro', label: 'Intro', description: 'Start here', order: 1 },
    { name: 'crm_setup', label: 'Setup', order: 2 },
  ];

  it('parses the real resolver output and PRESERVES it', () => {
    const tree = resolveBookTree(BookSchema.parse(spine) as Book, resolverDocs);
    const result = ResolvedBookSchema.safeParse(tree);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(JSON.parse(JSON.stringify(tree)));
  });

  it('the honest-empty tree parses — a book whose rules match nothing is a declared, legal body', () => {
    const empty = { name: 'crm_guide', groups: [] };
    expect(ResolvedBookSchema.safeParse(empty).success).toBe(true);
  });

  it('each schema stays type-identical to the interface the resolver is typed by', () => {
    // The interfaces remain the compile-time source `resolveBookTree` is typed
    // by; these pins are what keeps the Zod transcription from drifting.
    expectTypeOf<z.infer<typeof ResolvedEntrySchema>>().toEqualTypeOf<ResolvedEntry>();
    expectTypeOf<z.infer<typeof ResolvedGroupSchema>>().toEqualTypeOf<ResolvedGroup>();
    expectTypeOf<z.infer<typeof ResolvedBookSchema>>().toEqualTypeOf<ResolvedBook>();
  });
});
