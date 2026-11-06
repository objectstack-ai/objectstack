// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The `sms/test` answer carries every language on the platform locale table,
// and a caller's code finds its own language's entry: `zh-TW` the Traditional
// one (never the Simplified), a stored alias its table language, anything else
// English.

import { describe, it, expect } from 'vitest';
import { PLATFORM_LOCALE_TAGS, type PlatformLocaleTag } from '@objectstack/spec/system';
import { SMS_TEST_COPY, smsTestCopy, type SmsTestCopy, type SmsTestCopyLocale } from './sms-test-copy.js';

const KEY_OF_TAG: Record<PlatformLocaleTag, SmsTestCopyLocale> = {
  en: 'en', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-Hant', es: 'es-ES', ar: 'ar', fr: 'fr',
  'pt-BR': 'pt-BR', ru: 'ru', de: 'de', ja: 'ja-JP', ko: 'ko',
};
const KEYS = PLATFORM_LOCALE_TAGS.map((tag) => KEY_OF_TAG[tag]);

/** Every sentence of an entry, its functions called with sample arguments. */
const sentences = (copy: SmsTestCopy): Record<string, string> => ({
  invalidTo: copy.invalidTo,
  noSignedIn: copy.noSignedIn,
  noEngine: copy.noEngine,
  readFailed: copy.readFailed('sys_user is unavailable'),
  noNumber: copy.noNumber,
  missing: copy.missing('twilio', 'twilio_auth_token'),
  buildFailed: copy.buildFailed('aliyun', 'bad endpoint'),
  logOnly: copy.logOnly,
  sentVia: copy.sent('+86 ••• 0001', 'twilio', 'SM_1'),
  sentConfigured: copy.sent('+86 ••• 0001', undefined, 'SM_1'),
  failedWithReason: copy.failed('Twilio said no'),
  failedBare: copy.failed(undefined),
});

describe('sms/test copy carries the eleven platform languages', () => {
  it('has exactly one entry per platform locale table language', () => {
    expect(Object.keys(SMS_TEST_COPY).sort()).toEqual([...KEYS].sort());
    expect(KEYS).toHaveLength(11);
  });

  it('every entry carries every sentence, written in its own language (no English fill)', () => {
    const en = sentences(SMS_TEST_COPY.en);
    for (const key of KEYS) {
      for (const [field, text] of Object.entries(sentences(SMS_TEST_COPY[key]))) {
        expect(text.trim(), `${key}.${field}`).not.toBe('');
        if (key !== 'en') expect(text, `${key}.${field}`).not.toBe(en[field]);
      }
    }
  });

  it('each table tag and stored alias is served its own language; zh-TW never the Simplified entry', () => {
    for (const tag of PLATFORM_LOCALE_TAGS) expect(smsTestCopy(tag), tag).toBe(SMS_TEST_COPY[KEY_OF_TAG[tag]]);
    for (const [code, key] of [
      ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-CN', 'zh-CN'], ['zh', 'zh-CN'],
      ['ja-JP', 'ja-JP'], ['es-ES', 'es-ES'], ['pt', 'pt-BR'], ['en-US', 'en'], ['fr-CA', 'fr'],
    ] as const) {
      expect(smsTestCopy(code), code).toBe(SMS_TEST_COPY[key]);
    }
    expect(smsTestCopy('zh-TW')).not.toBe(SMS_TEST_COPY['zh-CN']);
  });

  it('a code naming no language here, or none at all, is served English', () => {
    for (const code of ['xx', 'sw-KE', undefined]) expect(smsTestCopy(code), String(code)).toBe(SMS_TEST_COPY.en);
  });

  it('the English sentences are the ones every caller read before', () => {
    const en = SMS_TEST_COPY.en;
    expect(en.missing('twilio', 'twilio_auth_token')).toBe('twilio: missing twilio_auth_token.');
    expect(en.sent('+86 ••• 0001', undefined, 'SM_1'))
      .toBe('Sent test SMS to +86 ••• 0001 via the deployment\'s configured transport (id=SM_1).');
    expect(en.failed(undefined)).toBe('Send failed.');
    expect(en.failed('Twilio said no')).toBe('Twilio said no');
  });
});
