// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11220 — a flow screen select that declares no `placeholder` shows
 * the locale's own "Select…" word, not an English literal.
 *
 * `ScreenFieldInput` drew `field.placeholder || 'Select…'`, so the named
 * producer (objectstack `examples/app-todo`, `screen_1`'s `category`: a
 * `type: 'select'` with `options`, no `placeholder`, no `defaultValue`) read
 * "Select…" in the runtime `FlowRunner` dialog and in Studio's screen preview
 * under every locale. The fallback now reads the shared `common.select` key —
 * the word the object form's own lookup picker (`LookupField`) already shows
 * in the same spot — so this file asserts the key's IDENTITY (what the bound
 * instance answers for `common.select`), never its copy.
 *
 * `??`, not `||`: an authored `placeholder: ''` is the author's choice and
 * renders as authored (the triage grade on objectui#11220 asked the claim to
 * state which behaviour it keeps; it keeps this one).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { ScreenView, type ScreenSpec, type ScreenFieldSpec } from './ScreenView';

afterEach(cleanup);

/** The named producer's field: options, no `placeholder`, no `defaultValue`. */
const CATEGORY: ScreenFieldSpec = {
  name: 'category',
  label: 'Category',
  type: 'select',
  options: [
    { value: 'personal', label: 'Personal' },
    { value: 'work', label: 'Work' },
  ],
};

function specOf(fields: ScreenSpec['fields']): ScreenSpec {
  return { nodeId: 'screen_1', title: 'Step', fields } as ScreenSpec;
}

function view(fields: ScreenSpec['fields']) {
  return <ScreenView screen={specOf(fields)} values={{}} onValueChange={() => {}} />;
}

/** Mount under the provider the console mounts, in `language`; returns the bound instance. */
function renderIn(language: string, fields: ScreenSpec['fields']) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      {view(fields)}
    </I18nProvider>,
  );
  return instance;
}

function categoryTrigger() {
  return screen.getByRole('combobox', { name: 'Category' });
}

describe('objectui#11220 — a screen select with no placeholder reads `common.select` in the active locale', () => {
  it('under zh, the fallback is the zh pack\'s `common.select`, not the en word', () => {
    const zh = renderIn('zh-CN', [{ ...CATEGORY }]);
    const zhWord = zh.t('common.select');
    const enWord = zh.getFixedT('en')('common.select');

    // The pin is only a pin if the two packs disagree; otherwise an English
    // literal would satisfy it.
    expect(zhWord).not.toBe(enWord);
    expect(zhWord).not.toBe('common.select');
    expect(categoryTrigger()).toHaveTextContent(zhWord);
    expect(categoryTrigger()).not.toHaveTextContent(enWord);
  });

  it('under en, the fallback is the en pack\'s `common.select`', () => {
    const en = renderIn('en', [{ ...CATEGORY }]);
    expect(categoryTrigger()).toHaveTextContent(en.t('common.select'));
  });

  it('with no I18nProvider, the fallback is the en word, never the raw key', () => {
    // A host that mounts `ScreenView` bare gets no i18next instance, and the
    // bare hook answers the raw KEY unless the call carries its en default.
    render(view([{ ...CATEGORY }]));
    const text = categoryTrigger().textContent ?? '';
    expect(text).not.toContain('common.select');
    const enWord = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false }).t('common.select');
    expect(text).toContain(enWord);
  });

  it('CONTROL — an authored placeholder renders verbatim under zh', () => {
    const zh = renderIn('zh-CN', [{ ...CATEGORY, placeholder: 'Pick a category' }]);
    expect(categoryTrigger()).toHaveTextContent('Pick a category');
    expect(categoryTrigger()).not.toHaveTextContent(zh.t('common.select'));
  });

  it('an authored empty placeholder stays empty (`??`, not `||`)', () => {
    const zh = renderIn('zh-CN', [{ ...CATEGORY, placeholder: '' }]);
    expect(categoryTrigger()).not.toHaveTextContent(zh.t('common.select'));
    expect(categoryTrigger()).not.toHaveTextContent(zh.getFixedT('en')('common.select'));
    expect((categoryTrigger().textContent ?? '').trim()).toBe('');
  });
});
