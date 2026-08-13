// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_VALIDATION_MESSAGES,
  VALIDATION_MESSAGE_FALLBACK_LOCALE,
  interpolateValidationMessage,
  renderValidationMessage,
  validationMessageTranslationKey,
} from './validation-message';

/**
 * #3957 — the write path's built-in messages were hardcoded English templates
 * with the API field name concatenated in, so a `zh-CN` user reading a rejected
 * import row got `penalty_amount must be ≥ 0`. These tests pin the catalog's
 * contract: every locale is complete, `en` output is unchanged from the
 * pre-#3957 strings, and a deployment can override any message.
 */
describe('validation message catalog — completeness', () => {
  const en = BUILTIN_VALIDATION_MESSAGES[VALIDATION_MESSAGE_FALLBACK_LOCALE];

  it('ships the four platform locales', () => {
    expect(Object.keys(BUILTIN_VALIDATION_MESSAGES).sort()).toEqual(
      ['en', 'es-ES', 'ja-JP', 'zh-CN'],
    );
  });

  /**
   * `en` is the last-resort fallback, so a key missing from ANOTHER locale
   * degrades to English — but a key missing from `en` degrades to
   * `<label> (<messageKey>)`. Every locale carrying every key is what keeps a
   * localized deployment from silently falling back mid-sentence.
   */
  it('every locale defines every message key', () => {
    const expected = Object.keys(en).sort();
    for (const [locale, catalog] of Object.entries(BUILTIN_VALIDATION_MESSAGES)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(expected);
    }
  });

  it('every template names the field via {{label}}, never a bare API name', () => {
    for (const [locale, catalog] of Object.entries(BUILTIN_VALIDATION_MESSAGES)) {
      for (const [key, template] of Object.entries(catalog)) {
        expect(template, `${locale}.${key}`).toContain('{{label}}');
        expect(template, `${locale}.${key}`).not.toContain('{{field}}');
      }
    }
  });

  /**
   * The bounds must reach the reader. A template that dropped `{{min}}` would
   * produce "必须大于或等于" with no number — worse than the English it replaced.
   */
  it('the bounded codes interpolate their bound in every locale', () => {
    const required: Record<string, string[]> = {
      min_value: ['{{min}}'],
      max_value: ['{{max}}'],
      max_scale: ['{{scale}}', '{{actual}}'],
      min_length: ['{{minLength}}', '{{actual}}'],
      max_length: ['{{maxLength}}', '{{actual}}'],
      invalid_option: ['{{allowed}}'],
      invalid_option_value: ['{{value}}', '{{allowed}}'],
      invalid_transition: ['{{from}}', '{{to}}'],
    };
    for (const [locale, catalog] of Object.entries(BUILTIN_VALIDATION_MESSAGES)) {
      for (const [key, placeholders] of Object.entries(required)) {
        for (const p of placeholders) {
          expect(catalog[key], `${locale}.${key}`).toContain(p);
        }
      }
    }
  });
});

describe('renderValidationMessage — English output is unchanged (#3957 no-regression)', () => {
  // Byte-for-byte the pre-#3957 strings, with the field's label where the API
  // name used to be interpolated.
  const cases: Array<[string, Record<string, unknown> | undefined, string]> = [
    ['required', undefined, 'Amount is required'],
    ['min_value', { min: 0 }, 'Amount must be ≥ 0'],
    ['max_value', { max: 99999999.99 }, 'Amount must be ≤ 99999999.99'],
    ['max_length', { maxLength: 512, actual: 3000 }, 'Amount must be ≤ 512 characters (got 3000)'],
    ['min_length', { minLength: 3, actual: 1 }, 'Amount must be ≥ 3 characters (got 1)'],
    ['invalid_email', undefined, 'Amount must be a valid email address'],
    ['invalid_url', undefined, 'Amount must be a valid URL (scheme://...)'],
    ['invalid_phone', undefined, 'Amount must be a valid phone number'],
    ['invalid_number', undefined, 'Amount must be a number'],
    ['invalid_boolean', undefined, 'Amount must be true or false'],
    ['invalid_date', undefined, 'Amount must be a valid date (ISO-8601)'],
    ['invalid_datetime', undefined, 'Amount must be a valid datetime (ISO-8601)'],
    ['invalid_time', undefined, 'Amount must be a valid time (HH:MM or HH:MM:SS)'],
    ['invalid_option', { allowed: 'a, b' }, 'Amount must be one of: a, b'],
    ['invalid_option_value', { value: 'z', allowed: 'a, b' }, 'Amount: "z" is not one of: a, b'],
    ['invalid_type_array', undefined, 'Amount must be an array of values'],
  ];

  for (const [messageKey, params, expected] of cases) {
    it(`renders ${messageKey}`, () => {
      expect(renderValidationMessage({ messageKey, label: 'Amount', params })).toBe(expected);
    });
  }
});

describe('renderValidationMessage — locale selection', () => {
  it('renders zh-CN with the localized label', () => {
    expect(
      renderValidationMessage(
        { messageKey: 'min_value', label: '处罚金额', field: 'penalty_amount', params: { min: 0 } },
        { locale: 'zh-CN' },
      ),
    ).toBe('处罚金额必须大于或等于 0');
  });

  it('renders ja-JP and es-ES', () => {
    expect(
      renderValidationMessage({ messageKey: 'required', label: '氏名' }, { locale: 'ja-JP' }),
    ).toBe('氏名は必須です');
    expect(
      renderValidationMessage({ messageKey: 'required', label: 'Nombre' }, { locale: 'es-ES' }),
    ).toBe('Nombre es obligatorio');
  });

  // BCP-47 matching, same ladder as bundle lookup: a client sending `zh` or
  // `ZH-cn` must not silently drop to English.
  it.each(['zh', 'zh-cn', 'ZH-CN', 'zh-Hans-CN'])('matches %s to zh-CN', (locale) => {
    expect(
      renderValidationMessage({ messageKey: 'invalid_number', label: '数量' }, { locale }),
    ).toBe('数量必须是数字');
  });

  it('falls back to en for an unsupported locale', () => {
    expect(
      renderValidationMessage({ messageKey: 'invalid_number', label: 'Qty' }, { locale: 'fr-FR' }),
    ).toBe('Qty must be a number');
  });

  it('defaults to en when no locale is supplied', () => {
    expect(renderValidationMessage({ messageKey: 'required', label: 'Qty' })).toBe('Qty is required');
  });
});

describe('renderValidationMessage — deployment overrides', () => {
  const key = validationMessageTranslationKey('min_value');

  it('uses a translation when the i18n service resolves the key', () => {
    const translate = (k: string) => (k === key ? '{{label}}不得小于 {{min}} 元' : k);
    expect(
      renderValidationMessage(
        { messageKey: 'min_value', label: '处罚金额', params: { min: 0 } },
        { locale: 'zh-CN', translate },
      ),
    ).toBe('处罚金额不得小于 0 元');
  });

  /**
   * `II18nService.t` echoes the key back on a miss — that echo must not become
   * the user-facing message.
   */
  it('ignores the key-echo miss and uses the built-in', () => {
    const translate = (k: string) => k;
    expect(
      renderValidationMessage(
        { messageKey: 'min_value', label: '处罚金额', params: { min: 0 } },
        { locale: 'zh-CN', translate },
      ),
    ).toBe('处罚金额必须大于或等于 0');
  });

  it('accepts an already-interpolated override without double-substituting', () => {
    const translate = () => '处罚金额不得小于 0 元';
    expect(
      renderValidationMessage(
        { messageKey: 'min_value', label: '处罚金额', params: { min: 0 } },
        { locale: 'zh-CN', translate },
      ),
    ).toBe('处罚金额不得小于 0 元');
  });

  // A broken i18n plugin must degrade to the built-in catalog, never turn a
  // 400 into a 500.
  it('survives a throwing translator', () => {
    const translate = () => { throw new Error('i18n exploded'); };
    expect(
      renderValidationMessage({ messageKey: 'required', label: '数量' }, { locale: 'zh-CN', translate }),
    ).toBe('数量不能为空');
  });
});

describe('interpolateValidationMessage', () => {
  it('leaves an unresolved placeholder verbatim', () => {
    // Visible breakage beats a silent "must be ≥ ." — the missing param is
    // named right there in the message.
    expect(interpolateValidationMessage('{{label}} must be ≥ {{min}}', { label: 'Qty' }))
      .toBe('Qty must be ≥ {{min}}');
  });

  it('interpolates falsy values rather than skipping them', () => {
    expect(interpolateValidationMessage('{{label}} must be ≥ {{min}}', { label: 'Qty', min: 0 }))
      .toBe('Qty must be ≥ 0');
  });

  it('renders a label-only fallback for an unknown message key', () => {
    expect(renderValidationMessage({ messageKey: 'no_such_key', label: 'Qty' }))
      .toBe('Qty (no_such_key)');
  });
});
