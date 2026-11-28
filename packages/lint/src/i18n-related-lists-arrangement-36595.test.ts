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
import { collectExpectedEntries } from './i18n-walk.js';

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
      expect(findings[0].message, JSON.stringify(restated)).toContain('carries no `label` in the `.custom` arrangement');
      expect(findings[0].hint, JSON.stringify(restated)).toContain("{ list: 'contact', label }");
      expect(findings[0].message.length).toBeLessThanOrEqual(200);
      expect(findings[0].hint.length).toBeLessThanOrEqual(200);
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

  it('one arrangement entry never strips what a sibling entry of the same arrangement wrote, in either order', () => {
    // The registry collects the arrangement's entries first, then drops what
    // they cover from the owner's list: a bare child beside its labelled
    // dotted list leaves that label served.
    for (const arrangement of [[{ list: 'event.related_to', label: 'Meetings' }, 'event'], ['event', { list: 'event.related_to', label: 'Meetings' }]]) {
      expect(judge([{ extend: 'account', relatedLists: arrangement }], { 'event.related_to': { label: '会议' } }), JSON.stringify(arrangement))
        .toEqual([]);
    }
  });

  it('a dotted list one entry hides stays hidden beside the bare child a sibling entry names (#37622)', () => {
    // The object schema refuses a cancelling sibling only when both entries
    // name the SAME list (`refuseContradictoryRelatedListEntries`), so this
    // shape parses: the bare child drops the dotted list's label in the first
    // pass, and the hidden entry hides it in the second, in either order.
    for (const arrangement of [
      [{ list: 'event.related_to', hidden: true }, 'event'],
      ['event', { list: 'event.related_to', hidden: true }],
    ]) {
      const findings = judge([{ extend: 'account', relatedLists: arrangement }], { 'event.related_to': { label: '会议' } });
      expect(findings.map((f) => [f.severity, f.path]), JSON.stringify(arrangement)).toEqual([['error', KEY('event.related_to')]]);
      expect(findings[0].message, JSON.stringify(arrangement)).toContain('hidden');
      expect(findings[0].hint, JSON.stringify(arrangement)).toContain("{ list: 'event.related_to', label }");
    }
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

// [#37622] `os i18n extract` and `os i18n check` read the expected keys from
// `collectExpectedEntries`, which folds the owner's tab list with the same
// arrangement the rule above folds: every key the extractor scaffolds is one
// `os validate` accepts, and a list the arrangement labels is scaffolded.
describe('collectExpectedEntries — _relatedLists agree with the rule under a `.custom` arrangement (#37622)', () => {
  const expected = (objectExtensions: unknown[]) =>
    collectExpectedEntries({ objects: [ACCOUNT], objectExtensions } as never)
      .filter((entry) => entry.path[2] === '_relatedLists')
      .map((entry) => [entry.path[3], entry.sourceValue]);

  /** The keys the extractor scaffolds, translated, judged by the rule. */
  const scaffoldedJudged = (objectExtensions: unknown[]) => {
    const keys = Object.fromEntries(expected(objectExtensions).map(([list]) => [list, { label: '译文' }]));
    return judge(objectExtensions, keys);
  };

  const ARRANGEMENTS: Array<[string, unknown[]]> = [
    ['none', []],
    ['hides contact', [{ extend: 'account', relatedLists: [{ list: 'contact', hidden: true }] }]],
    ['names contact bare', [{ extend: 'account', relatedLists: ['contact'] }]],
    ['re-states contact with no label', [{ extend: 'account', relatedLists: [{ list: 'contact' }] }]],
    ['relabels contact', [{ extend: 'account', relatedLists: [{ list: 'contact', label: 'Clients' }] }]],
    ['labels a list the owner names bare', [{ extend: 'account', relatedLists: [{ list: 'case', label: 'Tickets' }] }]],
    ['hides every event list through the bare child', [{ extend: 'account', relatedLists: [{ list: 'event', hidden: true }] }]],
    ['labels the bare child', [{ extend: 'account', relatedLists: [{ list: 'event', label: 'Activity' }] }]],
    ['keeps the dotted label beside the bare child', [{ extend: 'account', relatedLists: ['event', { list: 'event.related_to', label: 'Meetings' }] }]],
  ];

  it('every scaffolded key is accepted by `os validate`, for every arrangement', () => {
    for (const [name, objectExtensions] of ARRANGEMENTS) {
      expect(scaffoldedJudged(objectExtensions), name).toEqual([]);
    }
  });

  it('scaffolds the tab titles the served object carries, with the text it serves', () => {
    expect(expected([])).toEqual([['contact', 'People'], ['event.related_to', 'Meetings']]);
    expect(expected(ARRANGEMENTS[1][1])).toEqual([['event.related_to', 'Meetings']]);
    expect(expected(ARRANGEMENTS[2][1])).toEqual([['event.related_to', 'Meetings']]);
    expect(expected(ARRANGEMENTS[4][1])).toEqual([['event.related_to', 'Meetings'], ['contact', 'Clients']]);
    expect(expected(ARRANGEMENTS[5][1])).toEqual([['contact', 'People'], ['event.related_to', 'Meetings'], ['case', 'Tickets']]);
    expect(expected(ARRANGEMENTS[6][1])).toEqual([['contact', 'People']]);
    expect(expected(ARRANGEMENTS[7][1])).toEqual([['contact', 'People'], ['event', 'Activity']]);
    expect(expected(ARRANGEMENTS[8][1])).toEqual([['contact', 'People'], ['event.related_to', 'Meetings']]);
  });

  it('asks for no title a code extender\'s placement alone gives, which the rule still accepts', () => {
    const placed = [{ extend: 'account', place: [{ list: 'quote', after: 'contact', label: 'Quotes' }] }];
    expect(expected(placed)).toEqual([['contact', 'People'], ['event.related_to', 'Meetings']]);
    expect(judge(placed, { quote: { label: '报价' } })).toEqual([]);
  });
});
