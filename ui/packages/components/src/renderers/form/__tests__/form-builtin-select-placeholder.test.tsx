/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The built-in `select` branch has ONE placeholder source — objectui#3272.
 *
 * The branch used to render `placeholder || 'Select an option'` behind a call
 * site that already supplies `t('common.selectOption')`, so the literal read
 * as unreachable dead code. It was not quite: the call site defaults with `??`,
 * which PRESERVES an authored `placeholder: ''`, and an empty string is falsy
 * — so the one stack that reached the literal was an author who deliberately
 * asked for a blank placeholder and got an untranslated English word instead.
 *
 * That is also the honest reverse-verification direction for this deletion:
 * restoring `|| 'Select an option'` turns the `placeholder: ''` case below red
 * and leaves the other two green, because those two never reached the literal
 * in the first place. They are here as the surviving pin — if a later refactor
 * drops the `t()` at the call site, there is no longer a second fallback to
 * mask it, and the zh case fails instead of quietly rendering English.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, not `beforeAll` (objectui#3010/#3021).
import '../../../renderers';

const options = [
  { label: 'Zhejiang', value: 'zj' },
  { label: 'California', value: 'ca' },
];

function renderSelectIn(language: string, fieldExtra: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [{ name: 'province', label: 'Province', type: 'select', options, ...fieldExtra }],
        }}
      />
    </I18nProvider>,
  );
}

describe('form renderer — built-in select placeholder (objectui#3272)', () => {
  it('uses the locale word when the author declared no placeholder (zh)', () => {
    renderSelectIn('zh');

    expect(screen.getByText('请选择')).toBeInTheDocument();
    expect(screen.queryByText('Select an option')).not.toBeInTheDocument();
  });

  it('uses the English word under an en provider', () => {
    renderSelectIn('en');

    expect(screen.getByText('Select an option')).toBeInTheDocument();
  });

  it('honours an authored placeholder verbatim, in any locale', () => {
    renderSelectIn('zh', { placeholder: 'Pick a province' });

    expect(screen.getByText('Pick a province')).toBeInTheDocument();
    expect(screen.queryByText('请选择')).not.toBeInTheDocument();
    expect(screen.queryByText('Select an option')).not.toBeInTheDocument();
  });

  it('honours an authored EMPTY placeholder instead of substituting English', () => {
    // The stack the deleted literal actually reached: `?? ` at the call site
    // keeps `''`, then `||` in the branch overrode it. Asserted in BOTH
    // locales because the defect was locale-independent — an `en` author who
    // asked for a blank placeholder was overridden just the same.
    renderSelectIn('zh', { placeholder: '' });
    expect(screen.queryByText('Select an option')).not.toBeInTheDocument();
    expect(screen.queryByText('请选择')).not.toBeInTheDocument();

    renderSelectIn('en', { placeholder: '' });
    expect(screen.queryByText('Select an option')).not.toBeInTheDocument();
  });
});
