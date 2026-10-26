/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The built-in `select` branch's empty state is translated — objectui#3263.
 *
 * `type: 'select'` is a `BUILTIN_FIELD_TYPES` member, so a bare select never
 * reaches the `field:` registry: it renders the form renderer's own inline
 * branch. That branch had TWO empty sentences and only one of them spoke the
 * user's language — the dependency gate went through `t()`
 * (`fields.options.selectFirst`, objectui#3231) while the generic "nothing to
 * offer" copy was a hardcoded English literal. Under a `zh` session a gated
 * list read Chinese and an unconfigured one English, from the same widget.
 *
 * Both sentences are asserted here, in one locale, precisely because the defect
 * was the SPLIT: pinning only the new key would let the pair drift apart again.
 * The English no-provider fallback lives in
 * `form-builtin-select-empty-default.test.tsx` — mounting `I18nProvider` here
 * installs its instance as react-i18next's global default, so within this
 * module graph there is no "no provider" state left to observe.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

function renderFormIn(language: string, fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />
    </I18nProvider>,
  );
}

/** Nothing to offer at all — the branch's own empty copy (`fields.options.empty`). */
const unconfiguredSelect = [
  { name: 'province', label: 'Province', type: 'select', options: [] },
];

/** Waiting on its controlling field — the gate copy (`fields.options.selectFirst`). */
const gatedSelect = [
  { name: 'country', label: 'Country', type: 'input', defaultValue: '' },
  {
    name: 'province',
    label: 'Province',
    type: 'select',
    dependsOn: 'country',
    options: [
      { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
      { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
    ],
  },
];

describe('form renderer — built-in select empty state speaks the session locale (objectui#3263)', () => {
  it('renders the unconfigured copy in Chinese under a zh provider', () => {
    renderFormIn('zh', unconfiguredSelect);

    expect(screen.getByText('暂无可选项')).toBeInTheDocument();
    // The literal this replaced. Asserted negatively as well as positively:
    // a re-inlined English string would still let the positive assertion pass
    // if the box ever rendered both.
    expect(screen.queryByText(/no options available/i)).not.toBeInTheDocument();
  });

  it('renders the dependency-gate copy in Chinese from the same branch', () => {
    renderFormIn('zh', gatedSelect);

    // `Select {{fields}} first` with the controlling field's label interpolated.
    expect(screen.getByText('请先选择Country')).toBeInTheDocument();
    expect(screen.queryByText(/select .* first/i)).not.toBeInTheDocument();
  });

  it('keeps the gate and the empty copy in ONE language as the gate lifts', async () => {
    // The transition the split used to expose: gated (Chinese) -> parent set,
    // but this parent value matches no option, so the list is empty (used to
    // flip to English mid-interaction, in the same widget, same session).
    renderFormIn('zh', gatedSelect);

    expect(screen.getByText('请先选择Country')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'jp' } });

    await waitFor(() => {
      expect(screen.getByText('暂无可选项')).toBeInTheDocument();
    });
    expect(screen.queryByText(/no options available/i)).not.toBeInTheDocument();
  });
});
