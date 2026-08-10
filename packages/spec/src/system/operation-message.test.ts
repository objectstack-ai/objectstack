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
