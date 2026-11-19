// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_VALIDATION_MESSAGES,
  renderValidationMessage,
  validationMessageTranslationKey,
} from './validation-message';

/**
 * A deployment's `validation.field.<messageKey>` override is interpolated ONCE.
 * `{{value}}` is what the user wrote, so a value that itself contains a
 * placeholder (`{{label}}`) must be printed as written — not expanded into the
 * field label by a second pass.
 *
 * The translator is shaped as `FileI18nAdapter.t` answers: handed `params`, it
 * fills `{{name}}` itself. Asked for the template with params, its answer would
 * already carry the user's `{{label}}`, and the renderer's own pass would then
 * expand it. Asked without params, it returns the template and the renderer
 * fills it exactly once.
 */
describe('renderValidationMessage — a deployment override is interpolated once', () => {
  const key = validationMessageTranslationKey('invalid_option_value');
  const overrideTemplate = '{{label}}的取值「{{value}}」无效，请从 {{allowed}} 中选择';
  const interpolatingTranslate = (k: string, _locale: string, params?: Record<string, unknown>) => {
    if (k !== key) return k;
    return params && Object.keys(params).length > 0
      ? overrideTemplate.replace(/\{\{(\w+)\}\}/g, (m, name: string) => (params[name] != null ? String(params[name]) : m))
      : overrideTemplate;
  };
  const written = '{{label}} plan';
  const input = {
    messageKey: 'invalid_option_value',
    label: '套餐',
    field: 'plan',
    params: { value: written, allowed: 'basic, pro' },
  };

  it('prints a written value containing a placeholder as written on the override path', () => {
    expect(renderValidationMessage(input, { locale: 'zh-CN', translate: interpolatingTranslate }))
      .toBe(`套餐的取值「${written}」无效，请从 basic, pro 中选择`);
  });

  it('CONTROL — the built-in path, which was already single-pass, prints it as written too', () => {
    expect(renderValidationMessage(input, { locale: 'zh-CN' })).toBe(
      BUILTIN_VALIDATION_MESSAGES['zh-CN'].invalid_option_value
        .replace('{{label}}', '套餐')
        .replace('{{value}}', () => written)
        .replace('{{allowed}}', 'basic, pro'),
    );
  });
});
