// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29895] `sys_user.locale` is stored in its BCP-47 case — on a real boot, at
// the HTTP door.
//
// ## What the card measured
//
// A member's `PATCH /api/v1/data/sys_user/OWN_ID {"locale":"zh-cn"}` answered
// 200 and stored `zh-cn` verbatim (`ZH-CN` likewise); the console picks its UI
// language by exact match, so that user's console rendered English with no
// error anywhere. `zh-CN` rendered Chinese. #29833 had corrected case for
// translation locales only.
//
// ## What is pinned here
//
//   - `zh-cn` and `ZH-CN` through the member's own-row PATCH are stored as
//     `zh-CN`, and `/auth/me/localization` serves `zh-CN`;
//   - `zh-CN` is stored unchanged (the control);
//   - `zh_CN` is still refused with 400 VALIDATION_FAILED and the stored value
//     does not move (fold only, never a new refusal or a new acceptance);
//   - a system-context write (the import and IdP-sync shape) is folded too.
//
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const EMAIL = 'locale-case@user-locale-29895.verify.test';

describe('[#29895] sys_user.locale is stored in its BCP-47 case at the data door', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';
  let userId = '';

  const storedLocale = async (): Promise<unknown> => {
    const rows = await ql.find('sys_user', { where: { id: userId }, limit: 1, context: SYS });
    const list = Array.isArray(rows) ? rows : (rows?.records ?? []);
    return list[0]?.locale;
  };
  const patchOwn = (locale: unknown) => stack.apiAs(token, 'PATCH', `/data/sys_user/${userId}`, { locale });

  beforeAll(async () => {
    stack = await bootShowcase();
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    token = await stack.signUp(EMAIL, 'LocaleCase!Pass123', 'Locale Case Member');
    const rows = await ql.find('sys_user', { where: { email: EMAIL }, limit: 1, context: SYS });
    userId = String((Array.isArray(rows) ? rows : (rows?.records ?? []))[0]?.id ?? '');
    expect(userId, 'the signed-up member has a sys_user row').not.toBe('');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it.each(['zh-cn', 'ZH-CN'])('a member own-row PATCH of a mis-cased tag (%s) is stored canonical', async (sent) => {
    // Start from a different value so the assertion below reads this write.
    await ql.update('sys_user', { id: userId, locale: 'en-US' }, { context: SYS });
    const res = await patchOwn(sent);
    expect(res.status).toBe(200);
    expect(await storedLocale()).toBe('zh-CN');
  });

  it('the localization door serves the stored canonical tag', async () => {
    await patchOwn('zh-cn');
    const res = await stack.apiAs(token, 'GET', '/auth/me/localization');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { locale?: string; data?: { locale?: string } };
    expect(body.locale ?? body.data?.locale).toBe('zh-CN');
  });

  it('a canonical tag is stored unchanged (the control)', async () => {
    await ql.update('sys_user', { id: userId, locale: 'en-US' }, { context: SYS });
    const res = await patchOwn('zh-CN');
    expect(res.status).toBe(200);
    expect(await storedLocale()).toBe('zh-CN');
  });

  it('an underscore tag is still refused with 400 VALIDATION_FAILED and the stored value does not move', async () => {
    await ql.update('sys_user', { id: userId, locale: 'en-US' }, { context: SYS });
    const res = await patchOwn('zh_CN');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; error?: { code?: string } };
    expect(body.code ?? body.error?.code).toBe('VALIDATION_FAILED');
    expect(await storedLocale()).toBe('en-US');
  });

  it('a system-context write (the import and IdP-sync shape) is folded too', async () => {
    await ql.update('sys_user', { id: userId, locale: 'JA-jp' }, { context: SYS });
    expect(await storedLocale()).toBe('ja-JP');
  });
});
