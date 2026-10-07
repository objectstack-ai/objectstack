// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  PHONE_SMS_TOPICS,
  builtinPhoneSmsBody,
  interpolatePhoneSms,
  phoneSmsLocaleChain,
  resolvePhoneSmsTemplateBody,
} from './phone-sms-texts.js';

describe('phoneSmsLocaleChain', () => {
  it('expands a regioned locale and always ends in en', () => {
    expect(phoneSmsLocaleChain('zh-CN')).toEqual(['zh-CN', 'zh', 'en']);
    expect(phoneSmsLocaleChain('zh')).toEqual(['zh', 'en']);
    expect(phoneSmsLocaleChain('en-US')).toEqual(['en-US', 'en']);
    expect(phoneSmsLocaleChain(undefined)).toEqual(['en']);
  });
});

describe('builtin templates', () => {
  it('carry an en row for every topic (terminal fallback guarantee)', () => {
    for (const topic of Object.values(PHONE_SMS_TOPICS)) {
      expect(builtinPhoneSmsBody(topic, undefined)).toBeTruthy();
    }
  });

  it('resolve zh for zh-CN deployments', () => {
    const body = builtinPhoneSmsBody(PHONE_SMS_TOPICS.otp, 'zh-CN');
    expect(body).toContain('验证码');
    expect(body).toContain('{{code}}');
  });

  it('fall back to en for locales without a bundled text', () => {
    const body = builtinPhoneSmsBody(PHONE_SMS_TOPICS.otp, 'ja-JP');
    expect(body).toContain('verification code');
  });
});

describe('interpolatePhoneSms', () => {
  it('substitutes holes and blanks unknown ones', () => {
    expect(
      interpolatePhoneSms('您的 {{appName}} 验证码为 {{code}}，{{minutes}} 分钟内有效。', {
        appName: '对象栈',
        code: '123456',
        minutes: 5,
      }),
    ).toBe('您的 对象栈 验证码为 123456，5 分钟内有效。');
    expect(interpolatePhoneSms('x {{missing}} y', {})).toBe('x  y');
  });
});

describe('resolvePhoneSmsTemplateBody', () => {
  /**
   * Rows answered as the engine answers `find`: by every key in `where`, plain
   * equality only. A combinator is REFUSED, never read as a field name
   * (`check:where-matcher`).
   */
  const engineWith = (rows: Array<Record<string, unknown>>) => ({
    find: vi.fn(async (_obj: string, q: any) =>
      rows.filter((r) => Object.entries(q.where).every(([k, v]) => {
        if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
          throw new Error(`engineWith(): unsupported where clause on '${k}'`);
        }
        return r[k] === v;
      })).slice(0, q.limit ?? Infinity),
    ),
  });

  it('returns the tenant row for the exact locale', async () => {
    const engine = engineWith([
      { topic: 'auth.phone_otp', channel: 'sms', locale: 'zh-CN', is_active: true, body: '自定义 {{code}}' },
    ]);
    await expect(resolvePhoneSmsTemplateBody(engine, 'auth.phone_otp', 'zh-CN')).resolves.toBe('自定义 {{code}}');
  });

  it('walks the locale chain (zh-CN → zh) to a row', async () => {
    const engine = engineWith([
      { topic: 'auth.phone_otp', channel: 'sms', locale: 'zh', is_active: true, body: 'zh 行 {{code}}' },
    ]);
    await expect(resolvePhoneSmsTemplateBody(engine, 'auth.phone_otp', 'zh-CN')).resolves.toBe('zh 行 {{code}}');
  });

  it('renders the built-in text at the first rung that has one and no row', async () => {
    const zh = builtinPhoneSmsBody(PHONE_SMS_TOPICS.otp, 'zh');
    // An `en` row is NOT reached for a zh-CN recipient: the `zh` rung has a
    // built-in text and no row, which is what the retired seed's `zh` row was.
    const engine = engineWith([
      { topic: 'auth.phone_otp', channel: 'sms', locale: 'en', is_active: true, body: 'en row {{code}}' },
    ]);
    await expect(resolvePhoneSmsTemplateBody(engine, 'auth.phone_otp', 'zh-CN')).resolves.toBe(zh);
  });

  it('passes a deactivated row\'s rung on, as the seeded store did', async () => {
    const engine = engineWith([
      { topic: 'auth.phone_otp', channel: 'sms', locale: 'zh', is_active: false, body: '停用 {{code}}' },
      { topic: 'auth.phone_otp', channel: 'sms', locale: 'en', is_active: true, body: 'en row {{code}}' },
    ]);
    await expect(resolvePhoneSmsTemplateBody(engine, 'auth.phone_otp', 'zh-CN')).resolves.toBe('en row {{code}}');
  });

  it('falls back to the built-in walk with no engine, or a broken lookup', async () => {
    const zh = builtinPhoneSmsBody(PHONE_SMS_TOPICS.otp, 'zh');
    await expect(resolvePhoneSmsTemplateBody(undefined, 'auth.phone_otp', 'zh')).resolves.toBe(zh);
    const broken = { find: vi.fn(async () => { throw new Error('no such table'); }) };
    await expect(resolvePhoneSmsTemplateBody(broken, 'auth.phone_otp', 'zh')).resolves.toBe(zh);
  });
});
