/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Un-authored submit/cancel button copy follows the session locale — #3272.
 *
 * `submitLabel` / `cancelLabel` used to carry English DEFAULTS in the
 * destructuring (`submitLabel = 'Submit'`). That made two different things
 * indistinguishable — "the author said nothing" and "the author typed
 * Submit" — and locked every un-labelled form's action bar to English in a
 * zh/ja/ar session, which no amount of translating the rest of the form could
 * undo. The default is now the ABSENCE of a value; the fallback happens at
 * render through `common.submit` / `common.cancel`.
 *
 * The direction that matters most here is the SECOND one: an authored label
 * must still win VERBATIM. A render-time fallback is only safe if it cannot
 * reach a form whose author did declare the copy — otherwise the fix would
 * have traded one silent override for another, translating text the author
 * deliberately wrote. Both directions are pinned below, and the `''` case
 * pins `??` (not `||`), which is the whole difference between "unset" and
 * "explicitly blank".
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, not `beforeAll` (objectui#3010/#3021).
import '../../../renderers';

const fields = [{ name: 'name', label: 'Name', type: 'input' }];

function renderFormIn(language: string, schemaExtra: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Form schema={{ type: 'form', showCancel: true, fields, ...schemaExtra }} />
    </I18nProvider>,
  );
}

describe('form renderer — action-bar labels fall back through i18n (objectui#3272)', () => {
  it('renders the English words under an en provider', () => {
    // Byte-identical to the literal defaults this replaced.
    renderFormIn('en');

    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders Chinese under a zh provider', () => {
    renderFormIn('zh');

    expect(screen.getByRole('button', { name: '提交' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    // The literals, asserted absent.
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('renders Japanese under a ja provider', () => {
    renderFormIn('ja');

    expect(screen.getByRole('button', { name: '送信' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('an authored label wins VERBATIM over the locale fallback', () => {
    // The nail this whole change hangs on: the fallback may only fill an
    // absence. An authored string is the author's copy — including an English
    // one under a zh session, and including one that happens to be a word the
    // locale pack also knows.
    renderFormIn('zh', { submitLabel: 'Create account', cancelLabel: 'Nevermind' });

    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nevermind' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  });

  it('an authored label wins verbatim in the OTHER direction too', () => {
    // Authored Chinese under an `en` session — the fallback is not a
    // "translate the button" step, it is a "fill the blank" step.
    renderFormIn('en', { submitLabel: '立即提交' });

    expect(screen.getByRole('button', { name: '立即提交' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('an authored empty label stays empty — `??`, not `||`', () => {
    // `submitLabel: ''` is a declaration ("render no text"), not an absence.
    // A `||` fallback would silently overwrite it with the locale word, which
    // is the same class of override the English default was.
    const { container } = renderFormIn('zh', { submitLabel: '', cancelLabel: '' });

    const submit = container.querySelector('button[type="submit"]');
    expect(submit).not.toBeNull();
    expect(submit!.textContent).toBe('');
    expect(screen.queryByRole('button', { name: '提交' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  });
});
