// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objects.<object>._relatedLists.<list>.label` on the two lint readers every
// object translation group has: the extractor walk that scaffolds and gates
// the key, and the orphan rule that refuses a key nothing reads. Both read the
// same fact the resolver does: an object-form `relatedLists` entry on the
// parent that AUTHORS a `label`, keyed by its literal `list`.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries } from './i18n-walk.js';
import { validateTranslationReferences, TRANSLATION_TARGET_UNKNOWN } from './validate-translation-references.js';

const ACCOUNT = {
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

describe('collectExpectedEntries — a relatedLists entry\'s label', () => {
  const entries = collectExpectedEntries({ objects: [ACCOUNT] }, { warnedGroups: new Set() });
  const relatedListEntries = entries.filter((e) => e.path[2] === '_relatedLists');

  it('emits the key for each labelled object entry, a dotted list as one key, seeded from the label', () => {
    expect(relatedListEntries.map((e) => [e.path, e.sourceValue, e.inline])).toEqual([
      [['objects', 'account', '_relatedLists', 'contact', 'label'], 'People', 'People'],
      [['objects', 'account', '_relatedLists', 'event.related_to', 'label'], 'Meetings', 'Meetings'],
    ]);
    expect(relatedListEntries.every((e) => e.source === 'object' && e.objectName === 'account')).toBe(true);
  });

  it('emits nothing for an entry with no label, a bare name or a built-in tab', () => {
    const lists = relatedListEntries.map((e) => e.path[3]);
    expect(lists).not.toContain('opportunity');
    expect(lists).not.toContain('case');
    expect(lists).not.toContain('sys_activity');
  });
});

describe('validateTranslationReferences — _relatedLists', () => {
  const stackWith = (relatedLists: Record<string, unknown>) => ({
    objects: [ACCOUNT],
    translations: [{ 'zh-CN': { objects: { account: { _relatedLists: relatedLists } } } }],
  });

  it('resolves a key over each labelled entry, the dotted one included', () => {
    expect(validateTranslationReferences(stackWith({
      contact: { label: '联系人' },
      'event.related_to': { label: '会议' },
    }))).toEqual([]);
  });

  it('flags a key naming no entry, and one over an entry that carries no label', () => {
    const findings = validateTranslationReferences(stackWith({
      contacts: { label: '联系人' },
      opportunity: { label: '商机' },
      case: { label: '工单' },
    }));
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [TRANSLATION_TARGET_UNKNOWN, 'error', 'translations[0]["zh-CN"].objects.account._relatedLists.contacts'],
      [TRANSLATION_TARGET_UNKNOWN, 'error', 'translations[0]["zh-CN"].objects.account._relatedLists.opportunity'],
      [TRANSLATION_TARGET_UNKNOWN, 'error', 'translations[0]["zh-CN"].objects.account._relatedLists.case'],
    ]);
    // A misspelt list is pointed at the labelled one it nearly names.
    expect(findings[0].message).toContain('"contact"');
    for (const f of findings) {
      expect(f.message.length, f.message).toBeLessThanOrEqual(200);
      expect(f.hint.length, f.hint).toBeLessThanOrEqual(200);
    }
  });

  it('resolves a key over a labelled entry an extension brings: a `.custom` arrangement or a list placement', () => {
    const translations = [{ 'zh-CN': { objects: { account: { _relatedLists: { quote: { label: '报价' } } } } } }];
    const arrangement = {
      objects: [ACCOUNT],
      objectExtensions: [{ extend: 'account', relatedLists: [{ list: 'quote', label: 'Quotes' }, 'contact'] }],
      translations,
    };
    expect(validateTranslationReferences(arrangement)).toEqual([]);
    const placement = {
      objects: [ACCOUNT],
      objectExtensions: [{ extend: 'account', place: [{ list: 'quote', after: 'contact', label: 'Quotes' }] }],
      translations,
    };
    expect(validateTranslationReferences(placement)).toEqual([]);
    // Control: the same extension entry with no label titles nothing.
    const unlabelled = {
      objects: [ACCOUNT],
      objectExtensions: [{ extend: 'account', place: [{ list: 'quote', after: 'contact' }] }],
      translations,
    };
    expect(validateTranslationReferences(unlabelled).map((f) => f.path))
      .toEqual(['translations[0]["zh-CN"].objects.account._relatedLists.quote']);
  });

  it('names a built-in tab as such, listed or not: no form, no child field to point at', () => {
    const findings = validateTranslationReferences(stackWith({
      sys_activity: { label: '动态' },
      sys_attachment: { label: '附件' },
    }));
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0]["zh-CN"].objects.account._relatedLists.sys_activity',
      'translations[0]["zh-CN"].objects.account._relatedLists.sys_attachment',
    ]);
    for (const f of findings) {
      expect(f.message).toContain('built-in record-page tab');
      expect(f.hint).not.toContain('relatedListTitle');
      expect(f.hint).not.toContain('{ list, label }');
      expect(f.hint.length, f.hint).toBeLessThanOrEqual(200);
    }
  });

  it('does not count a `.custom` entry with `hidden: true` as labelled', () => {
    const translations = [{ 'zh-CN': { objects: { account: { _relatedLists: { quote: { label: '报价' } } } } } }];
    const findings = validateTranslationReferences({
      objects: [ACCOUNT],
      objectExtensions: [{ extend: 'account', relatedLists: [{ list: 'quote', label: 'Quotes', hidden: true }, 'contact'] }],
      translations,
    });
    expect(findings.map((f) => f.path)).toEqual(['translations[0]["zh-CN"].objects.account._relatedLists.quote']);
    expect(findings[0].message).toContain('hidden');
    expect(findings[0].message.length).toBeLessThanOrEqual(200);
  });

  it('brackets a dotted list in the finding path, as the locale segment is', () => {
    const findings = validateTranslationReferences(stackWith({ 'event.owner_id': { label: '会议' } }));
    expect(findings.map((f) => f.path))
      .toEqual(['translations[0]["zh-CN"].objects.account._relatedLists["event.owner_id"]']);
  });

  it('flags every key on an object that declares no relatedLists', () => {
    const findings = validateTranslationReferences({
      objects: [{ ...ACCOUNT, relatedLists: undefined }],
      translations: [{ 'zh-CN': { objects: { account: { _relatedLists: { contact: { label: '联系人' } } } } } }],
    });
    expect(findings.map((f) => f.path)).toEqual(['translations[0]["zh-CN"].objects.account._relatedLists.contact']);
  });
});
