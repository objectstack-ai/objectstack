// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `books.<name>.…` — a doc book's translation group, and the translator that
// overlays it on the served `book` document.
//
// Before this group existed a doc's body followed the reader's locale while
// the frame around it did not: the book title and every sidebar section title
// shipped in the authoring language, because the book's own inline map had
// been retired (no resolver ever read it) and the bundle had no key for it.

import { describe, it, expect } from 'vitest';
import {
  TranslationDataSchema,
  TranslationItemSchema,
  PlatformTranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import { translateMetadataDocument, translateBook, TRANSLATABLE_METADATA_TYPES } from './i18n-resolver';
// The fixture is PARSED by the authoring schema rather than hand-shaped, so a
// translator reading a member the schema does not carry cannot pass here.
import { BookSchema, resolveBookTree } from './book.zod';

const book = () => BookSchema.parse({
  name: 'crm_manual',
  label: 'User Manual',
  description: 'Everything a sales rep needs',
  groups: [
    { key: 'start', label: 'Getting started', include: 'crm_start_*' },
    { key: 'pipeline', label: 'Pipeline', include: 'crm_pipe_*' },
  ],
}) as any;

const bundle: TranslationBundle = {
  'zh-CN': {
    books: {
      crm_manual: {
        label: '使用手册',
        description: '销售代表需要的一切',
        groups: { start: { label: '快速上手' }, pipeline: { label: '销售管道' } },
      },
    },
  },
};

describe('TranslationDataSchema — books', () => {
  it('opens at all three doors — bundle entry, platform bundle and registered item', () => {
    expect(TranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(PlatformTranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(TranslationItemSchema.safeParse({ locale: 'zh-CN', ...bundle['zh-CN'] }).success).toBe(true);
  });

  it('closes the face at the book\'s `label` / `description` and each group\'s `label`', () => {
    for (const entry of [{ crm_manual: { icon: 'book' } }, { crm_manual: { groups: { start: { order: 1 } } } }]) {
      const result = TranslationDataSchema.safeParse({ books: entry });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
    }
  });

  it('renames the singular and the book\'s own aliases onto the declared keys', () => {
    expect(() => TranslationDataSchema.parse({ book: { b: { label: 'x' } } })).toThrow(/books/);
    expect(() => TranslationDataSchema.parse({ books: { b: { title: 'x' } } })).toThrow(/label/);
    expect(() => TranslationDataSchema.parse({ books: { b: { sections: {} } } })).toThrow(/groups/);
    expect(() => TranslationDataSchema.parse({ books: { b: { groups: { g: { title: 'x' } } } } })).toThrow(/label/);
  });

  it('the inline map on the book stays retired, and its prescription names the bundle group', () => {
    const result = BookSchema.safeParse({ ...book(), translations: { 'zh-CN': { label: '使用手册' } } });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error!.issues)).toContain('books.<book>.groups.<group_key>.label');
  });
});

describe('translateBook', () => {
  it('is registered in the dispatch table, so the REST boundary follows', () => {
    // `TRANSLATABLE_METADATA_TYPES` is DERIVED from the dispatch table and
    // `@objectstack/rest` reads it: `GET /meta/book` (list and item) is
    // localized, and the tree route translates through the same table.
    expect(TRANSLATABLE_METADATA_TYPES.has('book')).toBe(true);
  });

  it('a zh-CN reader gets the book title, description and every section title', () => {
    const out = translateMetadataDocument('book', book(), bundle, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('使用手册');
    expect(out.description).toBe('销售代表需要的一切');
    expect(out.groups.map((g: any) => [g.key, g.label])).toEqual([['start', '快速上手'], ['pipeline', '销售管道']]);
    // Identity and the membership rules ride through untouched.
    expect(out.name).toBe('crm_manual');
    expect(out.groups.map((g: any) => g.include)).toEqual(['crm_start_*', 'crm_pipe_*']);
  });

  it('the translated book renders a translated spine through the tree resolver', () => {
    const docs = [{ name: 'crm_start_login', label: '登录' }, { name: 'crm_pipe_stages', label: '阶段' }];
    const tree = resolveBookTree(translateBook(book(), bundle, { locale: 'zh-CN' }), docs);
    expect(tree.label).toBe('使用手册');
    expect(tree.groups.map((g) => g.label)).toEqual(['快速上手', '销售管道']);
  });

  it('an en-US reader is unchanged — the same reference, the authored strings', () => {
    const doc = book();
    expect(translateBook(doc, bundle, { locale: 'en-US' })).toBe(doc);
    expect(translateBook(doc, undefined, { locale: 'zh-CN' })).toBe(doc);
  });

  it('a missing translation falls back to the authored string, per key', () => {
    const partial: TranslationBundle = { 'zh-CN': { books: { crm_manual: { groups: { pipeline: { label: '销售管道' } } } } } };
    const out = translateBook(book(), partial, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('User Manual');
    expect(out.description).toBe('Everything a sales rep needs');
    expect(out.groups.map((g: any) => g.label)).toEqual(['Getting started', '销售管道']);
  });

  it('reads only its own book\'s entry, and applies the BCP-47 ladder and the fallback chain', () => {
    const other = BookSchema.parse({ name: 'crm_admin_manual', label: 'Admin Manual', groups: [{ key: 'start', label: 'Start' }] }) as any;
    expect(translateBook(other, bundle, { locale: 'zh-CN' })).toBe(other);
    expect((translateBook(book(), bundle, { locale: 'zh' }) as any).label).toBe('使用手册');
    expect((translateBook(book(), bundle, { locale: 'fr-FR', fallbackChain: ['zh-CN'] }) as any).label).toBe('使用手册');
  });

  it('does not mutate the input', () => {
    const doc = book();
    const before = JSON.parse(JSON.stringify(doc));
    translateBook(doc, bundle, { locale: 'zh-CN' });
    expect(doc).toEqual(before);
  });
});
