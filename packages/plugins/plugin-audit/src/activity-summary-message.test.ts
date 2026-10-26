// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26167] The summary code's composer, and the read-side overlay, against a
 * REAL locale: `createMemoryI18n` (what the kernel registers as the `i18n`
 * fallback) loaded with this plugin's shipped bundle plus an app's labels, so
 * the key shapes asked are the bundles' own. The real read path is pinned in
 * `activity-summary-reader-locale.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';

import { AuditTranslations } from './translations/index.js';
import {
  ACTIVITY_SUMMARY_MESSAGE_KEY,
  composeActivitySummary,
  composeStoredSummary,
  localizeActivityRow,
  readActivitySummaryMessage,
  readerSummaryLocale,
  type ActivitySummaryMessage,
} from './activity-summary-message.js';

const DEFS: Record<string, any> = {
  biz_deal: {
    name: 'biz_deal',
    label: 'Deal',
    fields: {
      stage: { label: 'Stage', options: [{ value: 'won', label: 'Won' }] },
      amount: { label: 'Amount' },
      owner: { label: 'Owner' },
    },
  },
};
const getObjectDef = (name: string) => DEFS[name] ?? null;

function makeI18n() {
  const i18n = createMemoryI18n();
  for (const [locale, data] of Object.entries(AuditTranslations)) {
    i18n.loadTranslations(locale, data as Record<string, any>);
  }
  i18n.loadTranslations('zh-CN', {
    objects: {
      biz_deal: {
        label: '商机',
        fields: { stage: { label: '阶段', options: { won: '赢单' } }, amount: { label: '金额' } },
      },
    },
  });
  return i18n;
}

const zh = () => readerSummaryLocale(makeI18n(), 'zh-CN', getObjectDef)!;
const ja = () => readerSummaryLocale(makeI18n(), 'ja-JP', getObjectDef)!;

const CREATED: ActivitySummaryMessage = { key: 'activityCreated', object: 'biz_deal', label: 'Acme' };
const NAMED: ActivitySummaryMessage = {
  key: 'activityUpdatedFields',
  object: 'biz_deal',
  label: 'Acme',
  fields: ['amount', 'owner'],
  more: 2,
};
const CHANGES: ActivitySummaryMessage = {
  key: 'fieldChanges',
  object: 'biz_deal',
  changes: [
    { field: 'stage', from: { text: '∅' }, to: { text: 'Won', option: 'won' } },
    { field: 'owner', from: { text: '张伟' }, to: { text: 'Ana' } },
  ],
};

describe('composeActivitySummary — one code, each reader\'s language (#26167)', () => {
  it('composes every template in the reader locale, labels resolved per reader', () => {
    expect(composeActivitySummary(CREATED, zh())).toBe('创建了 商机 "Acme"');
    expect(composeActivitySummary({ ...CREATED, key: 'activityDeleted' }, zh())).toBe('删除了 商机 "Acme"');
    expect(composeActivitySummary({ ...CREATED, key: 'activityUpdated' }, zh())).toBe('更新了 商机 "Acme"');
    // `owner` has no zh-CN label: the authored one answers; the list is zh-CN's.
    expect(composeActivitySummary(NAMED, zh())).toBe('更新了 商机 "Acme"：金额、Owner和另外 2 个字段');
    // An option value is the reader's option label; a title is the record's own datum.
    expect(composeActivitySummary(CHANGES, zh())).toBe('阶段: ∅ → 赢单; Owner: 张伟 → Ana');
  });

  it('falls back to the authored labels where the reader\'s pack has none', () => {
    expect(composeActivitySummary(CREATED, ja())).toBe('Deal「Acme」を作成しました');
    expect(composeActivitySummary(CHANGES, ja())).toBe('Stage: ∅ → Won; Owner: 张伟 → Ana');
  });

  it('answers undefined for a locale with no template, and the field-less frame where only that exists', () => {
    const fr = createMemoryI18n();
    const none = readerSummaryLocale(fr, 'fr-FR', getObjectDef)!;
    expect(composeActivitySummary(CREATED, none)).toBeUndefined();
    fr.loadTranslations('fr-FR', { messages: { activityUpdated: 'A mis à jour {{object}} « {{label}} »' } });
    const older = readerSummaryLocale(fr, 'fr-FR', getObjectDef)!;
    expect(composeActivitySummary(NAMED, older)).toBe('A mis à jour Deal « Acme »');
  });

  it('the stored sentence is the write locale\'s, else the English catalog\'s — never a second spelling', () => {
    expect(composeStoredSummary(NAMED, zh())).toBe('更新了 商机 "Acme"：金额、Owner和另外 2 个字段');
    const none = readerSummaryLocale(createMemoryI18n(), 'fr-FR', getObjectDef)!;
    expect(composeStoredSummary(CREATED, none)).toBe('Created Deal "Acme"');
    expect(composeStoredSummary(NAMED, none)).toBe('Updated Deal "Acme": Amount, Owner, and 2 more');
  });
});

describe('readerSummaryLocale — the reader\'s negotiated locale', () => {
  it('negotiates against the held packs: a bare `zh` reads the zh-CN pack', () => {
    expect(composeActivitySummary(CREATED, readerSummaryLocale(makeI18n(), 'zh', getObjectDef)!)).toBe(
      '创建了 商机 "Acme"',
    );
  });

  it('composes nothing without a locale or a `t()`', () => {
    expect(readerSummaryLocale(makeI18n(), undefined, getObjectDef)).toBeUndefined();
    expect(readerSummaryLocale(makeI18n(), '', getObjectDef)).toBeUndefined();
    expect(readerSummaryLocale(undefined, 'zh-CN', getObjectDef)).toBeUndefined();
  });

  it('a throwing service is a miss, never a failed read', () => {
    const throwing = readerSummaryLocale(
      {
        t: () => {
          throw new Error('boom');
        },
      },
      'zh-CN',
      getObjectDef,
    )!;
    expect(composeActivitySummary(CREATED, throwing)).toBeUndefined();
  });
});

describe('readActivitySummaryMessage — only a code this version can compose', () => {
  it('accepts each stored shape and refuses anything else', () => {
    for (const m of [CREATED, NAMED, CHANGES]) expect(readActivitySummaryMessage(m)).toEqual(m);
    expect(readActivitySummaryMessage({ key: 'activityArchived', object: 'biz_deal', label: 'x' })).toBeNull();
    expect(readActivitySummaryMessage({ key: 'activityCreated', object: 'biz_deal' })).toBeNull();
    expect(readActivitySummaryMessage({ ...NAMED, fields: [1] })).toBeNull();
    expect(readActivitySummaryMessage({ key: 'fieldChanges', object: 'biz_deal', changes: [{ field: 'x' }] })).toBeNull();
    expect(readActivitySummaryMessage('activityCreated')).toBeNull();
  });
});

describe('localizeActivityRow — the read-side overlay', () => {
  const row = (metadata: unknown, summary = 'Created Deal "Acme"') => ({ summary, metadata });
  const stored = (message: unknown) => JSON.stringify({ old: null, new: { name: 'Acme' }, [ACTIVITY_SUMMARY_MESSAGE_KEY]: message });

  it('overlays the summary and drops the code from what a caller is served', () => {
    const r: Record<string, unknown> = row(stored(CREATED));
    localizeActivityRow(r, zh(), true);
    expect(r.summary).toBe('创建了 商机 "Acme"');
    expect(JSON.parse(r.metadata as string)).toEqual({ old: null, new: { name: 'Acme' } });
  });

  it('keeps the code for the system, and works on a parsed `metadata` object too', () => {
    const r: Record<string, unknown> = row({ old: null, new: {}, [ACTIVITY_SUMMARY_MESSAGE_KEY]: CREATED });
    localizeActivityRow(r, zh(), false);
    expect(r.summary).toBe('创建了 商机 "Acme"');
    expect((r.metadata as Record<string, unknown>)[ACTIVITY_SUMMARY_MESSAGE_KEY]).toEqual(CREATED);
  });

  it('keeps the stored sentence with no locale, an unknown code, or a missing template — and still drops the code', () => {
    for (const [message, locale] of [
      [CREATED, undefined],
      [{ key: 'activityArchived', object: 'biz_deal', label: 'Acme' }, zh()],
      [CREATED, readerSummaryLocale(createMemoryI18n(), 'fr-FR', getObjectDef)],
    ] as const) {
      const r: Record<string, unknown> = row(stored(message));
      localizeActivityRow(r, locale, true);
      expect(r.summary).toBe('Created Deal "Acme"');
      expect(JSON.parse(r.metadata as string)).not.toHaveProperty(ACTIVITY_SUMMARY_MESSAGE_KEY);
    }
  });

  it('a row written before the change (no code) and a row whose summary was not projected are left alone', () => {
    const legacy: Record<string, unknown> = row(JSON.stringify({ old: null, new: { name: 'Acme' } }));
    localizeActivityRow(legacy, zh(), true);
    expect(legacy).toEqual(row(JSON.stringify({ old: null, new: { name: 'Acme' } })));

    const unprojected: Record<string, unknown> = { metadata: stored(CREATED) };
    localizeActivityRow(unprojected, zh(), true);
    expect(unprojected).not.toHaveProperty('summary');
  });
});
