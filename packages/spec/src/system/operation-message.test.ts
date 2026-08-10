// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_OPERATION_MESSAGES,
  OPERATION_MESSAGE_FALLBACK_LOCALE,
  operationMessageTranslationKey,
  renderOperationMessage,
} from './operation-message';

/**
 * #7307 — the catalog half. The engine call site is pinned in
 * `packages/objectql/src/engine-delete-restricted-locale.test.ts`.
 */
describe('operation message catalog', () => {
  const PARAMS = { object: '部门', dependentObject: '零星申请', field: '申报部门', count: 1 };

  it('renders the caller locale, not English', () => {
    const zh = renderOperationMessage({ messageKey: 'delete_restricted', params: PARAMS }, { locale: 'zh-CN' });
    expect(zh).toBe('该部门正被 1 条零星申请记录通过「申报部门」引用,请先删除或改派这些记录。');
  });

  it('falls back to en for an unknown locale, and en is the declared fallback', () => {
    expect(OPERATION_MESSAGE_FALLBACK_LOCALE).toBe('en');
    const out = renderOperationMessage({ messageKey: 'delete_restricted', params: PARAMS }, { locale: 'xx-YY' });
    expect(out).toBe(BUILTIN_OPERATION_MESSAGES.en.delete_restricted
      .replace('{{object}}', '部门')
      .replace('{{count}}', '1')
      .replace('{{dependentObject}}', '零星申请')
      .replace('{{field}}', '申报部门'));
  });

  it('matches a base language against a regional catalog key (zh → zh-CN)', () => {
    expect(renderOperationMessage({ messageKey: 'delete_restricted', params: PARAMS }, { locale: 'zh' }))
      .toContain('请先删除或改派这些记录');
  });

  it('every locale defines every key en defines', () => {
    const enKeys = Object.keys(BUILTIN_OPERATION_MESSAGES.en).sort();
    for (const [locale, catalog] of Object.entries(BUILTIN_OPERATION_MESSAGES)) {
      expect({ locale, keys: Object.keys(catalog).sort() }).toEqual({ locale, keys: enKeys });
    }
  });

  it('no built-in template leaks a metadata-authoring hint into the user-facing sentence', () => {
    // The whole point of the card: `deleteBehavior` is developer vocabulary and
    // must not reach a toast in ANY locale.
    for (const catalog of Object.values(BUILTIN_OPERATION_MESSAGES)) {
      for (const template of Object.values(catalog)) {
        expect(template).not.toMatch(/deleteBehavior|cascade/i);
      }
    }
  });

  it('the _required variant says the field cannot be cleared; the plain one does not', () => {
    const req = renderOperationMessage({ messageKey: 'delete_restricted_required', params: PARAMS }, { locale: 'zh-CN' });
    expect(req).toContain('必填');
    expect(renderOperationMessage({ messageKey: 'delete_restricted', params: PARAMS }, { locale: 'zh-CN' }))
      .not.toContain('必填');
  });

  it('a deployment translation override wins over the built-in', () => {
    const translate = (key: string) =>
      key === 'errors.delete_restricted' ? '不能删除:还有 {{count}} 条下级记录。' : key;
    expect(renderOperationMessage({ messageKey: 'delete_restricted', params: PARAMS }, { locale: 'zh-CN', translate }))
      .toBe('不能删除:还有 1 条下级记录。');
  });

  it('an override key that misses (echoed back) falls through to the built-in', () => {
    const translate = (key: string) => key;
    expect(renderOperationMessage({ messageKey: 'delete_restricted', params: PARAMS }, { locale: 'zh-CN', translate }))
      .toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].delete_restricted
        .replace('{{object}}', '部门')
        .replace('{{count}}', '1')
        .replace('{{dependentObject}}', '零星申请')
        .replace('{{field}}', '申报部门'));
  });

  it('a throwing i18n service does not turn a 409 into a 500', () => {
    const translate = () => { throw new Error('service down'); };
    expect(renderOperationMessage({ messageKey: 'delete_restricted', params: PARAMS }, { locale: 'zh-CN', translate }))
      .toContain('请先删除或改派这些记录');
  });

  it('an unknown message key returns the key rather than an empty string', () => {
    expect(renderOperationMessage({ messageKey: 'no_such_key' })).toBe('no_such_key');
  });

  it('addresses overrides under `errors.`, NOT the field-validation namespace', () => {
    expect(operationMessageTranslationKey('delete_restricted')).toBe('errors.delete_restricted');
    expect(operationMessageTranslationKey('delete_restricted')).not.toContain('validation.field');
  });
});

/**
 * #7414 — the SECOND consumer of this catalog: plugin-security's object-CRUD
 * gate (`403 PERMISSION_DENIED`). The call site is pinned in
 * `packages/plugins/plugin-security/src/permission-denied-user-copy.test.ts`,
 * against the real middleware and a real `II18nService`.
 */
describe('operation message catalog — permission_denied (#7414)', () => {
  /**
   * The vocabulary a business user must never read in a permission refusal.
   * `positions` is the internal authorization noun the reporter quoted; the
   * rest is the shape of the sentence it was embedded in.
   */
  const DEVELOPER_VOCABULARY = [
    'positions',
    'permissionSets',
    'permission set',
    '[Security]',
    'Access denied',
    'operation',
  ];

  it('renders the caller locale, not English', () => {
    expect(renderOperationMessage({ messageKey: 'permission_denied' }, { locale: 'zh-CN' }))
      .toBe('您没有执行此操作的权限,如需访问请联系管理员。');
    expect(renderOperationMessage({ messageKey: 'permission_denied' }, { locale: 'en' }))
      .toBe('You do not have permission to perform this action. Contact your administrator if you need access.');
  });

  it('matches a base language against a regional catalog key (ja → ja-JP)', () => {
    expect(renderOperationMessage({ messageKey: 'permission_denied' }, { locale: 'ja' }))
      .toBe(BUILTIN_OPERATION_MESSAGES['ja-JP'].permission_denied);
  });

  it('falls back to the en sentence for a locale the catalog does not carry', () => {
    // `de-DE` has no catalog entry and no base-language sibling.
    expect(renderOperationMessage({ messageKey: 'permission_denied' }, { locale: 'de-DE' }))
      .toBe(BUILTIN_OPERATION_MESSAGES.en.permission_denied);
  });

  it('names no object, no operation and no position — in EVERY locale', () => {
    const locales = Object.keys(BUILTIN_OPERATION_MESSAGES);
    // Guard the guard: a catalog that lost its locales would make the loop
    // below vacuously true, which is exactly the shape of an assertion that
    // cannot fail.
    expect(locales.length).toBeGreaterThanOrEqual(4);
    for (const locale of locales) {
      const rendered = renderOperationMessage({ messageKey: 'permission_denied' }, { locale });
      // Non-empty and locale-specific, so the absence assertions below cannot
      // be satisfied by an empty string.
      expect(rendered).toBe(BUILTIN_OPERATION_MESSAGES[locale].permission_denied);
      expect(rendered.length).toBeGreaterThan(10);
      for (const word of DEVELOPER_VOCABULARY) {
        expect(rendered.toLowerCase(), `${locale} must not say "${word}"`)
          .not.toContain(word.toLowerCase());
      }
    }
  });

  it('ships no unfilled placeholder in any locale — the sentence takes no params', () => {
    // ⚠️ This case is HYGIENE, not a revert-detector: it also passes on a
    // catalog with the key removed entirely (the fallback is the bare
    // messageKey, which has no braces either). Its value is catching a
    // template that shipped a `{{name}}` / `{name}` nobody fills — the #7333
    // class of bug, where the two brace conventions in this repo are mixed up.
    for (const [locale, catalog] of Object.entries(BUILTIN_OPERATION_MESSAGES)) {
      expect(catalog.permission_denied, `${locale} defines permission_denied`).toBeTypeOf('string');
      expect(catalog.permission_denied, `${locale} placeholder-free`).not.toMatch(/[{}]/);
    }
  });

  it('a deployment translation override wins, under the shared `errors.` address', () => {
    expect(operationMessageTranslationKey('permission_denied')).toBe('errors.permission_denied');
    const translate = (key: string) =>
      key === 'errors.permission_denied' ? '此操作已被安全策略阻止。' : key;
    expect(renderOperationMessage({ messageKey: 'permission_denied' }, { locale: 'zh-CN', translate }))
      .toBe('此操作已被安全策略阻止。');
  });

  it('a throwing i18n service does not turn a 403 into a 500', () => {
    const translate = () => { throw new Error('service down'); };
    expect(renderOperationMessage({ messageKey: 'permission_denied' }, { locale: 'zh-CN', translate }))
      .toBe(BUILTIN_OPERATION_MESSAGES['zh-CN'].permission_denied);
  });
});
