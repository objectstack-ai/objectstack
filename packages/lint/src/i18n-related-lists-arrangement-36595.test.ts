// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#36595] `objects.<object>._relatedLists.<list>` against the paired `.custom`
// arrangement (ADR-0146 D10). The registry applies the arrangement after the
// owner's list and every placement, and each of its entries REPLACES every
// entry it covers (`registry-custom-arrangement.ts`): a bare name or an
// unlabelled entry leaves the tab no `label` to translate, and
// `{ list, hidden: true }` leaves no tab at all. A key over a list the owner
// labelled but the arrangement re-states that way is read by nothing, and the
// translation-reference rule says so.

import { describe, it, expect } from 'vitest';
import { validateTranslationReferences, TRANSLATION_TARGET_UNKNOWN } from './validate-translation-references.js';

const ACCOUNT = {
  name: 'account',
  label: 'Account',
  fields: { name: { name: 'name', type: 'text', label: 'Name' } },
  relatedLists: [
    { list: 'contact', label: 'People' },
    { list: 'event.related_to', label: 'Meetings' },
    'case',
  ],
};

const KEY = (list: string) =>
  `translations[0]["zh-CN"].objects.account._relatedLists${list.includes('.') ? `["${list}"]` : `.${list}`}`;

function judge(objectExtensions: unknown[], keys: Record<string, unknown>) {
  return validateTranslationReferences({
    objects: [ACCOUNT],
    objectExtensions,
    translations: [{ 'zh-CN': { objects: { account: { _relatedLists: keys } } } }],
  });
}

describe('validateTranslationReferences — _relatedLists under a `.custom` arrangement (#36595)', () => {
  it('flags a key over an owner-labelled list the arrangement hides, saying it is hidden', () => {
    const findings = judge(
      [{ extend: 'account', relatedLists: [{ list: 'contact', hidden: true }] }],
      { contact: { label: '联系人' } },
    );
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([[TRANSLATION_TARGET_UNKNOWN, 'error', KEY('contact')]]);
    expect(findings[0].message).toContain('hidden');
    expect(findings[0].message.length).toBeLessThanOrEqual(200);
  });

  it('flags a key over an owner-labelled list the arrangement names bare, or as an entry with no label', () => {
    for (const restated of ['contact', { list: 'contact' }, { list: 'contact', hidden: false }]) {
      const findings = judge([{ extend: 'account', relatedLists: [restated] }], { contact: { label: '联系人' } });
      expect(findings.map((f) => f.path), JSON.stringify(restated)).toEqual([KEY('contact')]);
      expect(findings[0].message, JSON.stringify(restated)).toContain('carries no `label`');
    }
  });

  it('a bare child hides or strips every list of that child: the dotted owner entry included', () => {
    const hidden = judge(
      [{ extend: 'account', relatedLists: [{ list: 'event', hidden: true }] }],
      { 'event.related_to': { label: '会议' } },
    );
    expect(hidden.map((f) => f.path)).toEqual([KEY('event.related_to')]);
    expect(hidden[0].message).toContain('hidden');
    const bare = judge([{ extend: 'account', relatedLists: ['event'] }], { 'event.related_to': { label: '会议' } });
    expect(bare.map((f) => f.path)).toEqual([KEY('event.related_to')]);
  });

  it('applies the arrangement after every placement, whatever the extensions\' order', () => {
    // Two packages: the placing one folds AFTER the arrangement's (higher
    // priority, later in the artifact), and the arrangement still replaces
    // the placed entry, as the registry applies it.
    const findings = validateTranslationReferences({
      packages: [
        { manifest: { id: 'com.example.crm.custom', objectExtensions: [{ extend: 'account', priority: 100, relatedLists: ['quote'] }] } },
        { manifest: { id: 'com.example.quotes', objectExtensions: [{ extend: 'account', priority: 300, place: [{ list: 'quote', after: 'contact', label: 'Quotes' }] }] } },
      ],
      objects: [ACCOUNT],
      translations: [{ 'zh-CN': { objects: { account: { _relatedLists: { quote: { label: '报价' } } } } } }],
    });
    expect(findings.map((f) => f.path)).toEqual([KEY('quote')]);
  });

  it('accepts a key over a list the arrangement labels, and over owner lists it does not cover', () => {
    expect(judge(
      [{ extend: 'account', relatedLists: [{ list: 'contact', label: 'Clients' }, { list: 'event.owner_id', hidden: true }] }],
      { contact: { label: '客户' }, 'event.related_to': { label: '会议' } },
    )).toEqual([]);
    // One relationship does not cover its sibling or its bare child.
    expect(judge(
      [{ extend: 'account', relatedLists: ['event.owner_id', 'case'] }],
      { contact: { label: '联系人' }, 'event.related_to': { label: '会议' } },
    )).toEqual([]);
  });

  it('control: with no arrangement, the owner\'s labels resolve as before', () => {
    expect(judge([], { contact: { label: '联系人' }, 'event.related_to': { label: '会议' } })).toEqual([]);
    expect(judge(
      [{ extend: 'account', place: [{ list: 'quote', after: 'contact', label: 'Quotes' }] }],
      { contact: { label: '联系人' }, quote: { label: '报价' } },
    )).toEqual([]);
  });
});
