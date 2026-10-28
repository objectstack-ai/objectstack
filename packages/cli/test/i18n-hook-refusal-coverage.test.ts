// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#26170 — a hook's declared refusal catalogue joins the i18n
// buckets as `hooks.<hook>.refusals.<CODE>.message` (maintainer ruling
// 6431311681, letter A).
//
// A hook declaring `refusals: { <CODE>: { message, status? } }` refuses by code
// only, and the sandboxed body runner reads the key in the caller's locale
// before it answers. These pins are the CLI half: the walker scaffolds one key
// per declared entry, the coverage gate demands it, and the key the walker
// writes is the very address the runtime asks for (`hookRefusalMessageKey`),
// so the two cannot drift.
//
// The ledger mock is `i18n-flow-refusal-coverage.test.ts`'s, for its reason:
// these pins measure the bucket itself, whatever the shipped ledger says next.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/lint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@objectstack/lint')>()),
  authorWarnedProperties: () => new Set<string>(),
}));

import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema, hookRefusalMessageKey } from '@objectstack/spec/system';

const LIMIT = 'This order exceeds the customer credit limit.';
const HOLD = 'The account is on hold.';

const creditGuard = {
  name: 'credit_guard',
  object: 'order',
  events: ['beforeInsert'],
  body: { language: 'js', source: "throw Object.assign(new Error('x'), { code: 'CREDIT_LIMIT' });" },
  refusals: {
    CREDIT_LIMIT: { message: LIMIT },
    ACCOUNT_ON_HOLD: { message: HOLD, status: 409 },
  },
};

/** A hook with no catalogue contributes nothing. */
const plainHook = { name: 'stamp', object: 'order', events: ['beforeInsert'], handler: 'stamp' };

const hookEntries = (config: any) => collectExpectedEntries(config).filter((e) => e.path[0] === 'hooks');

describe('what the walker harvests from a hook catalogue (#26170)', () => {
  it('emits one key per declared entry, keyed as the runtime reads it, seeded with the message', () => {
    const entries = hookEntries({ hooks: [creditGuard, plainHook] });

    expect(entries.map((e) => e.path.join('.'))).toEqual([
      hookRefusalMessageKey('credit_guard', 'CREDIT_LIMIT'),
      hookRefusalMessageKey('credit_guard', 'ACCOUNT_ON_HOLD'),
    ]);
    expect(entries[0]).toMatchObject({ sourceValue: LIMIT, inline: LIMIT, source: 'hook' });
  });

  it('harvests nothing from a stack whose hooks declare no catalogue', () => {
    expect(hookEntries({ hooks: [plainHook] })).toEqual([]);
    expect(hookEntries({})).toEqual([]);
  });
});

describe('the coverage gate demands each declared refusal (#26170)', () => {
  const tree = (hooks?: Record<string, unknown>) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    hooks: [creditGuard],
    translations: [{ 'zh-CN': { ...(hooks ? { hooks } : {}) } }],
  });
  const zhHooks = (config: any) =>
    computeI18nCoverage(config).issues.filter((i) => i.locale === 'zh-CN' && i.key.startsWith('hooks.'));

  it('reports each untranslated refusal in the hook bucket', () => {
    const issues = zhHooks(tree());
    expect(issues.map((i) => i.key).sort()).toEqual([
      'hooks.credit_guard.refusals.ACCOUNT_ON_HOLD.message',
      'hooks.credit_guard.refusals.CREDIT_LIMIT.message',
    ]);
    expect(issues.every((i) => i.source === 'hook')).toBe(true);
  });

  it('counts what is still missing once one is translated', () => {
    const issues = zhHooks(tree({ credit_guard: { refusals: { CREDIT_LIMIT: { message: '订单超出客户信用额度。' } } } }));
    expect(issues.map((i) => i.key)).toEqual(['hooks.credit_guard.refusals.ACCOUNT_ON_HOLD.message']);
  });

  it('goes quiet once every entry is translated', () => {
    const issues = zhHooks(tree({
      credit_guard: {
        refusals: {
          CREDIT_LIMIT: { message: '订单超出客户信用额度。' },
          ACCOUNT_ON_HOLD: { message: '该客户账户已冻结。' },
        },
      },
    }));
    expect(issues).toEqual([]);
  });
});

describe('the skeleton `os i18n extract` writes (#26170)', () => {
  const result = extractTranslations({ hooks: [creditGuard] }, { locales: ['en', 'zh-CN'] });

  it('writes the message into the default locale and an empty slot into the others', () => {
    expect((result.bundles.en as any).hooks.credit_guard.refusals).toEqual({
      CREDIT_LIMIT: { message: LIMIT },
      ACCOUNT_ON_HOLD: { message: HOLD },
    });
    expect((result.bundles['zh-CN'] as any).hooks.credit_guard.refusals).toEqual({
      CREDIT_LIMIT: { message: '' },
      ACCOUNT_ON_HOLD: { message: '' },
    });
  });

  it('parses through the schema it is written for, in every locale', () => {
    for (const [locale, bundle] of Object.entries(result.bundles)) {
      expect(TranslationDataSchema.safeParse(bundle).success, `skeleton for ${locale}`).toBe(true);
    }
  });
});
