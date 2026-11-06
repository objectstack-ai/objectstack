// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every settings copy table this plugin writes carries every language on the
// platform locale table, and a caller's code finds its own language's entry:
// `zh-TW` the Traditional one (never the Simplified), a stored alias its
// table language, anything else English.

import { describe, it, expect } from 'vitest';
import { PLATFORM_LOCALE_TAGS, type PlatformLocaleTag } from '@objectstack/spec/system';
import type { SettingsCopyLocale } from './settings-copy-locale.js';
import { ALLOWED_IP_RANGES_REFUSAL_COPY, allowedIpRangesRefusalCopy } from './allowed-ip-ranges.js';
import { SIGN_IN_FLOOR_COPY, signInFloorCopy } from './sign-in-method-floor.js';
import { MFA_REQUIRED_ENROLLMENT_COPY, mfaRequiredEnrollmentCopy } from './mfa-required-enrollment-predicate.js';
import {
  ORGANIZATION_MFA_REFUSAL_COPY,
  ORGANIZATION_MFA_REQUIRED_NOTICE_COPY,
  organizationMfaRequiredNotice,
  organizationMfaWithoutEnrollmentRefusal,
} from './organization-mfa-enrollment-guard.js';

/** The key each platform table tag is served by. */
const KEY_OF_TAG: Record<PlatformLocaleTag, SettingsCopyLocale> = {
  en: 'en', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-Hant', es: 'es-ES', ar: 'ar', fr: 'fr',
  'pt-BR': 'pt-BR', ru: 'ru', de: 'de', ja: 'ja-JP', ko: 'ko',
};
const KEYS = PLATFORM_LOCALE_TAGS.map((tag) => KEY_OF_TAG[tag]);

/** An entry's sentences, functions called with sample arguments. */
function sentences(entry: unknown): Record<string, string> {
  if (typeof entry === 'string') return { text: entry };
  if (typeof entry === 'function') return { 0: entry(0), 1: entry(1), 7: entry(7), 22: entry(22) };
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(entry as Record<string, unknown>)) {
    out[field] = typeof value === 'function' ? value('203.0.113.7') : String(value);
  }
  return out;
}

interface Table {
  name: string;
  table: Record<string, unknown>;
  /** The table's own lookup, answering the entry a caller's code is served. */
  lookup(locale: string | undefined): unknown;
}

const TABLES: Table[] = [
  { name: 'allowed IP ranges refusal', table: ALLOWED_IP_RANGES_REFUSAL_COPY, lookup: allowedIpRangesRefusalCopy },
  { name: 'sign-in method floor', table: SIGN_IN_FLOOR_COPY, lookup: signInFloorCopy },
  { name: 'auth.mfa_required refusal', table: MFA_REQUIRED_ENROLLMENT_COPY, lookup: mfaRequiredEnrollmentCopy },
  {
    name: 'organization MFA refusal',
    table: ORGANIZATION_MFA_REFUSAL_COPY,
    lookup: (locale) => organizationMfaWithoutEnrollmentRefusal(locale).message,
  },
  {
    name: 'organization MFA notice',
    table: ORGANIZATION_MFA_REQUIRED_NOTICE_COPY,
    lookup: (locale) => organizationMfaRequiredNotice(7, locale),
  },
];

/** What a lookup answered, as comparable text. */
function served(t: Table, locale: string | undefined): string {
  const answer = t.lookup(locale);
  return JSON.stringify(typeof answer === 'string' ? answer : sentences(answer));
}

/** The text a lookup must answer when it serves `key`. */
function expected(t: Table, key: SettingsCopyLocale): string {
  const entry = t.table[key];
  if (t.name === 'organization MFA notice') return JSON.stringify((entry as (d: number) => string)(7));
  return JSON.stringify(typeof entry === 'string' ? entry : sentences(entry));
}

describe.each(TABLES)('$name copy carries the eleven platform languages', (t) => {
  it('has exactly one entry per platform locale table language', () => {
    expect(Object.keys(t.table).sort()).toEqual([...KEYS].sort());
    expect(KEYS).toHaveLength(11);
  });

  it('every entry carries every sentence, written in its own language (no English fill)', () => {
    const en = sentences(t.table.en);
    for (const key of KEYS) {
      const own = sentences(t.table[key]);
      expect(Object.keys(own).sort(), key).toEqual(Object.keys(en).sort());
      for (const [field, text] of Object.entries(own)) {
        expect(text.trim(), `${key}.${field}`).not.toBe('');
        if (key !== 'en') expect(text, `${key}.${field}`).not.toBe(en[field]);
      }
    }
  });

  it('each table tag, and each stored alias, is served its own language', () => {
    for (const tag of PLATFORM_LOCALE_TAGS) {
      expect(served(t, tag), tag).toBe(expected(t, KEY_OF_TAG[tag]));
    }
    for (const [code, key] of [
      ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-CN', 'zh-CN'], ['zh', 'zh-CN'],
      ['ja-JP', 'ja-JP'], ['es-ES', 'es-ES'], ['pt', 'pt-BR'], ['en-US', 'en'], ['fr-CA', 'fr'], ['de-AT', 'de'],
    ] as const) {
      expect(served(t, code), code).toBe(expected(t, key));
    }
  });

  it('zh-TW is never served the Simplified entry', () => {
    expect(served(t, 'zh-TW')).not.toBe(expected(t, 'zh-CN'));
  });

  it('a code naming no language here, or none at all, is served English', () => {
    for (const code of ['xx', 'tlh', undefined]) {
      expect(served(t, code), String(code)).toBe(expected(t, 'en'));
    }
  });
});

describe('organization MFA notice plurals', () => {
  it('Russian and Arabic count days in the right form', () => {
    expect(organizationMfaRequiredNotice(1, 'ru')).toContain('1 день');
    expect(organizationMfaRequiredNotice(3, 'ru')).toContain('3 дня');
    expect(organizationMfaRequiredNotice(11, 'ru')).toContain('11 дней');
    expect(organizationMfaRequiredNotice(21, 'ru')).toContain('21 день');
    expect(organizationMfaRequiredNotice(2, 'ar')).toContain('يومان');
    expect(organizationMfaRequiredNotice(7, 'ar')).toContain('7 أيام');
    expect(organizationMfaRequiredNotice(14, 'ar')).toContain('14 يومًا');
  });
});
