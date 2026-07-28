// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Success-envelope conformance for the dispatcher's `/i18n` domain — the
 * missing twin of `service-i18n`'s `error-envelope.conformance.test.ts`, and
 * the same pairing storage got in #3689.
 *
 * WHY THIS SUITE EXISTS
 *
 * Three consecutive defects landed on this one route family, and every one of
 * them was a body that did not match the schema declaring it:
 *
 *   #3676  the request declared `namespace`/`keys` filters no server read
 *   #3833  the field-labels derivation scanned a retired key dialect and so
 *          returned `{}` for every provider
 *   #3847  `labels` entries were emitted as bare strings under a schema
 *          declaring `{ label, help?, options? }`
 *
 * All three survived a green test suite, because every test asserted the
 * emitted body against a HAND-WRITTEN LITERAL. Comparing output to a literal
 * proves the code does what the test author believed; it cannot prove the code
 * does what the contract declares. Nothing had ever put the emitted value and
 * the declared schema in the same assertion.
 *
 * So these assertions parse each response with the schema `plugin-rest-api`
 * names for that route (`responseSchema: 'GetLocalesResponseSchema'`, …),
 * imported rather than restated. A body that parses is a body the SDK's
 * published return type does not lie about.
 *
 * The first thing the suite caught, on the day it was written: `GET
 * /i18n/locales` passed `getLocales()`'s raw `string[]` straight through,
 * while `GetLocalesResponseSchema` declares `{ code, label, isDefault }[]` and
 * service-i18n — the OTHER provider of this identical route — already emitted
 * descriptors. One endpoint, two shapes, decided by which plugin mounted it.
 * The dispatcher's copy of the field-labels derivation went wrong the same way
 * in #3833, one route over, which is why both mappings are now shared.
 *
 * The route ledgers cannot catch this. They audit which routes exist and
 * whether the SDK can address them, not what comes back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import { BaseResponseSchema } from '@objectstack/spec/api';
import {
  GetLocalesResponseSchema,
  GetTranslationsResponseSchema,
  GetFieldLabelsResponseSchema,
} from '@objectstack/spec/api';

/** The nested shape every producer writes (#3778). */
const BUNDLE = {
  objects: {
    contact: {
      label: '联系人',
      fields: {
        first_name: { label: '名' },
        email: { label: '邮箱', help: '主邮箱地址' },
        status: { label: '状态', options: { open: '进行中', closed: '已关闭' } },
        phone: { help: '优先手机' },
      },
    },
  },
  messages: { save: '保存' },
};

describe('/i18n success-envelope conformance (dispatcher domain)', () => {
  let dispatcher: HttpDispatcher;
  let i18nService: Record<string, unknown>;

  beforeEach(() => {
    i18nService = {
      getLocales: vi.fn().mockReturnValue(['en', 'zh-CN']),
      getDefaultLocale: vi.fn().mockReturnValue('en'),
      getTranslations: vi.fn().mockReturnValue(BUNDLE),
    };
    const kernel = {
      getService: vi.fn(async (name: string) => (name === 'i18n' ? i18nService : null)),
      services: new Map(),
      context: { getService: (name: string) => (name === 'i18n' ? i18nService : null) },
    };
    dispatcher = new HttpDispatcher(kernel as never);
  });

  /** Every success body must satisfy the shared envelope. */
  function expectEnvelope(body: unknown) {
    const parsed = BaseResponseSchema.safeParse(body);
    expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
    expect((body as { success?: boolean }).success).toBe(true);
  }

  it('GET /locales — body satisfies GetLocalesResponseSchema', async () => {
    const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} } as never);
    expect(result.response?.status).toBe(200);
    expectEnvelope(result.response?.body);

    const parsed = GetLocalesResponseSchema.safeParse(result.response?.body?.data);
    expect(
      parsed.success,
      `locales body does not match its declared schema: ${JSON.stringify(parsed.error?.issues)}`,
    ).toBe(true);
    expect(parsed.data?.locales).toEqual([
      { code: 'en', label: 'en', isDefault: true },
      { code: 'zh-CN', label: 'zh-CN', isDefault: false },
    ]);
  });

  it('GET /locales — a bare string[] is DEAD, so a revert cannot pass quietly', async () => {
    const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} } as never);
    const locales = result.response?.body?.data?.locales as unknown[];
    expect(locales.every((l) => typeof l === 'object' && l !== null)).toBe(true);
    expect(locales).not.toContain('en');
  });

  it('GET /translations/:locale — body satisfies GetTranslationsResponseSchema', async () => {
    const result = await dispatcher.handleI18n('/translations/zh-CN', 'GET', {}, { request: {} } as never);
    expect(result.response?.status).toBe(200);
    expectEnvelope(result.response?.body);

    const parsed = GetTranslationsResponseSchema.safeParse(result.response?.body?.data);
    expect(
      parsed.success,
      `translations body does not match its declared schema: ${JSON.stringify(parsed.error?.issues)}`,
    ).toBe(true);
  });

  it('GET /labels/:object/:locale — body satisfies GetFieldLabelsResponseSchema', async () => {
    const result = await dispatcher.handleI18n('/labels/contact/zh-CN', 'GET', {}, { request: {} } as never);
    expect(result.response?.status).toBe(200);
    expectEnvelope(result.response?.body);

    const parsed = GetFieldLabelsResponseSchema.safeParse(result.response?.body?.data);
    expect(
      parsed.success,
      `labels body does not match its declared schema: ${JSON.stringify(parsed.error?.issues)}`,
    ).toBe(true);
    // The entries are objects carrying what the bundle holds — the gap #3847
    // closed, pinned here against the contract rather than a literal.
    expect(parsed.data?.labels.email?.help).toBe('主邮箱地址');
    expect(parsed.data?.labels.status?.options?.open).toBe('进行中');
  });

  it('an empty label map is still a conforming body', async () => {
    const result = await dispatcher.handleI18n('/labels/unknown_object/zh-CN', 'GET', {}, { request: {} } as never);
    expect(result.response?.status).toBe(200);
    expect(GetFieldLabelsResponseSchema.safeParse(result.response?.body?.data).success).toBe(true);
  });

  /**
   * A provider may omit the optional `getDefaultLocale`. The descriptor
   * mapping must still produce a conforming body — `isDefault` is required by
   * the schema, so an undefined default must yield `false`, not `undefined`.
   */
  it('GET /locales conforms even when the provider omits getDefaultLocale', async () => {
    delete i18nService.getDefaultLocale;
    const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} } as never);
    const parsed = GetLocalesResponseSchema.safeParse(result.response?.body?.data);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.locales.every((l) => l.isDefault === false)).toBe(true);
  });
});
