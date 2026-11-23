// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objects.<object>._relatedLists.<list>.label` — the title an object-form
// `relatedLists` entry declares on the PARENT, and the translator that
// overlays it on the served parent object.
//
// The entry's `label` wins over the child FK's `relatedListTitle`, which the
// bundle already translated on the child; the winning title had no key, so a
// declared record-page tab title printed in the authoring language.

import { describe, it, expect } from 'vitest';
import {
  ObjectTranslationDataSchema,
  TranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import { translateMetadataDocument, translateObject } from './i18n-resolver';
import { ObjectSchema } from '../data/object.zod';

/** A parent whose tab list mixes every entry form. */
const PACKAGED = {
  name: 'account',
  label: 'Account',
  fields: { name: { name: 'name', type: 'text', label: 'Name' } },
  relatedLists: [
    { list: 'contact', label: 'People' },
    { list: 'event.related_to', label: 'Meetings' },
    { list: 'opportunity' },
    'case',
    'sys_activity',
  ],
};

const BUNDLE: TranslationBundle = {
  'zh-CN': {
    objects: {
      account: {
        label: '客户',
        _relatedLists: {
          contact: { label: '联系人' },
          'event.related_to': { label: '会议' },
          opportunity: { label: '商机' },
          case: { label: '工单' },
        },
      },
    },
  },
};

const clone = <V>(value: V): V => JSON.parse(JSON.stringify(value));
const listsOf = (out: unknown) => (out as { relatedLists: unknown[] }).relatedLists;

describe('ObjectTranslationDataSchema — _relatedLists', () => {
  it('accepts the key at the bundle and the per-object doors, a dotted list name included', () => {
    expect(TranslationDataSchema.safeParse(BUNDLE['zh-CN']).success).toBe(true);
    expect(ObjectTranslationDataSchema.safeParse({ _relatedLists: { 'event.related_to': { label: '会议' } } }).success)
      .toBe(true);
  });

  it('keeps the leaf closed: `label` is its one key', () => {
    const result = TranslationDataSchema.safeParse({
      objects: { account: { _relatedLists: { contact: { label: '联系人', columns: ['name'] } } } },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path).toEqual(['objects', 'account', '_relatedLists', 'contact']);
    expect(issue?.message).toContain('this related list title translation');
  });

  it('names `title` on the leaf as a rename onto `label`, and the un-prefixed group as `_relatedLists`', () => {
    const leaf = TranslationDataSchema.safeParse({ objects: { account: { _relatedLists: { contact: { title: 'x' } } } } });
    expect(leaf.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message).toContain('`title` → `label`');
    const group = TranslationDataSchema.safeParse({ objects: { account: { relatedLists: { contact: { label: 'x' } } } } });
    expect(group.success).toBe(false);
    expect(group.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
      .toContain('`relatedLists` → `_relatedLists`');
  });
});

describe('translateObject — a relatedLists entry\'s label', () => {
  it('serves the translated title on the parent\'s entry, through the type dispatch, and the object still parses', () => {
    const out = translateMetadataDocument('object', clone(PACKAGED), BUNDLE, { locale: 'zh-CN' });
    const lists = listsOf(out);
    expect(lists[0]).toEqual({ list: 'contact', label: '联系人' });
    // A dotted object.field list is one key, indexed directly.
    expect(lists[1]).toEqual({ list: 'event.related_to', label: '会议' });
    expect(ObjectSchema.safeParse(out).success).toBe(true);
  });

  it('swaps nothing in: an entry with no label, a bare name and a built-in tab are served as authored', () => {
    const lists = listsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh-CN' }));
    expect(lists[2]).toEqual({ list: 'opportunity' });
    expect(lists[3]).toBe('case');
    expect(lists[4]).toBe('sys_activity');
  });

  it('keeps an untranslated title as authored, and hands back the same array when nothing matched', () => {
    const doc = clone(PACKAGED);
    const out = translateObject(doc, BUNDLE, { locale: 'ja-JP' });
    expect(out.relatedLists).toBe(doc.relatedLists);
  });

  it('applies the BCP-47 ladder and the fallback chain, as `_tabs` does', () => {
    expect((listsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh' }))[0] as { label: string }).label)
      .toBe('联系人');
    expect(
      (listsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'fr-FR', fallbackChain: ['zh-CN'] }))[0] as {
        label: string;
      }).label,
    ).toBe('联系人');
  });

  describe('the catalog loses to an explicit override (ADR-0029 D9.2a)', () => {
    it('applies while the served label still equals the packaged entry\'s', () => {
      const lists = listsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED }));
      expect((lists[0] as { label: string }).label).toBe('联系人');
    });

    it('keeps a label a tenant rewrote, and one on an entry the base does not carry', () => {
      const doc = clone(PACKAGED);
      (doc.relatedLists[0] as { label: string }).label = 'Key People';
      doc.relatedLists.push({ list: 'case', label: 'Tickets' } as never);
      const base = { ...PACKAGED, relatedLists: PACKAGED.relatedLists.slice(0, 4) };
      const lists = listsOf(translateObject(doc, BUNDLE, { locale: 'zh-CN', packagedBase: base }));
      expect((lists[0] as { label: string }).label).toBe('Key People');
      expect((lists[5] as { label: string }).label).toBe('Tickets');
    });

    it('takes the paired package\'s translation for a label it changed', () => {
      const doc = clone(PACKAGED);
      (doc.relatedLists[0] as { label: string }).label = 'Key People';
      const pairBundle: TranslationBundle = {
        'zh-CN': { objects: { account: { _relatedLists: { contact: { label: '关键联系人' } } } } },
      };
      const lists = listsOf(translateObject(doc, BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED, pairBundle }));
      expect((lists[0] as { label: string }).label).toBe('关键联系人');
    });
  });
});
