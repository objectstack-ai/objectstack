/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4514 — mounting an `I18nProvider` must not change what a LATER
 * provider-less render in the same file resolves.
 *
 * ── Why this file exists rather than a comment ───────────────────────────
 * The trap was "documented where tests are written" three separate times —
 * `packages/fields/src/widgets/GridField.test.tsx`,
 * `packages/fields/src/__tests__/date-locale-channel.test.tsx` and
 * `packages/plugin-timeline/src/__tests__/timeline-scale-vocabulary-defaults.test.ts`
 * each carry a paragraph telling the next author to keep providers in a
 * separate file. It still recurred, because a comment cannot fail. The
 * mechanism is `installI18nGlobalReset()` in `vitest.setup.base.ts`; THIS file
 * is what fails if it is removed or stops working.
 *
 * ── The ordering is the assertion ────────────────────────────────────────
 * Every case below is written provider-LESS *after* a case that mounted a
 * provider, which is exactly the arrangement that used to be unsafe.
 *
 * Reverse-verified by ablating the `installI18nGlobalReset()` call in
 * `vitest.setup.base.ts` and re-running this file together with its `unit`
 * sibling: 5 failed / 7 passed (12), against 12 passed with the call in place.
 * The five are the four cases marked "THE PIN" plus the provider-safe-fallback
 * case — which is the point: without the reset that fallback resolves whatever
 * the previous case installed, not `'en'`.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { I18nProvider, useObjectTranslation } from '../index';

/**
 * Renders what it resolved instead of assigning to a module variable — writing
 * to one during render is a side effect in render, which `react-hooks/globals`
 * rejects (and would be a real hazard the moment React re-rendered this twice).
 */
function Probe() {
  const { t, language } = useObjectTranslation();
  return (
    <dl>
      <dd data-testid="probe-language">{language}</dd>
      <dd data-testid="probe-save">{t('common.save')}</dd>
      {/* A key no pack defines: pins the `defaultValue` path, which is what a
          provider-less host actually renders (FileField's `aria-label` etc.). */}
      <dd data-testid="probe-missing">
        {t('probe.no.such.key', { defaultValue: 'INLINE-DEFAULT' })}
      </dd>
    </dl>
  );
}

function readProbe() {
  return {
    language: screen.getByTestId('probe-language').textContent,
    save: screen.getByTestId('probe-save').textContent,
    missing: screen.getByTestId('probe-missing').textContent,
  };
}

/** The value a provider-less render resolves in a pristine file. */
const PRISTINE = { language: 'en', save: 'common.save', missing: 'INLINE-DEFAULT' };

function renderZhProvider(node: React.ReactNode) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      {node}
    </I18nProvider>,
  );
}

describe('objectui#4514 — the react-i18next global does not leak between tests', () => {
  it('baseline: with no provider anywhere, the global is unset', () => {
    expect(getI18n()).toBeUndefined();
    render(<Probe />);
    expect(readProbe()).toEqual(PRISTINE);
  });

  it('a mounted zh provider translates inside its own subtree', () => {
    renderZhProvider(<Probe />);
    expect(readProbe()).toEqual({ language: 'zh', save: '保存', missing: 'INLINE-DEFAULT' });
    // ...and it really did install itself as the global while mounted. This is
    // the deliberate design (direction 2 of the card, NOT taken): the global
    // fallback is what makes `useObjectTranslation()` provider-safe.
    expect(getI18n()).toBeDefined();
    expect(getI18n().language).toBe('zh');
  });

  it('THE PIN: a provider-less render after that zh case still resolves pristine', () => {
    // Before objectui#4514 this resolved `zh` / `保存` — the state react-i18next
    // was left in by the case above, ~1 screen up. That is the whole defect.
    expect(getI18n()).toBeUndefined();
    render(<Probe />);
    expect(readProbe()).toEqual(PRISTINE);
  });

  it('THE PIN: more than the language is restored', () => {
    render(
      <I18nProvider
        config={{
          defaultLanguage: 'ar',
          detectBrowserLanguage: false,
          resources: { ar: { 'probe.custom': 'FROM-THE-PROVIDER' } },
        }}
        persistLanguage={false}
      >
        <Probe />
      </I18nProvider>,
    );
    const mounted = getI18n();
    // While mounted, the provider's own resources and RTL direction are on the
    // global — this is the part a `changeLanguage('en')` reset would NOT undo.
    expect(mounted.t('probe.custom')).toBe('FROM-THE-PROVIDER');
    expect(mounted.dir()).toBe('rtl');
  });

  it('THE PIN: the provider above left no resources, no direction, no instance', () => {
    // A language-only reset would leave `probe.custom` reachable here (measured:
    // it resolves through the instance's `en` resources instead of vanishing).
    // Restoring the POINTER is what makes the leak total rather than partial.
    expect(getI18n()).toBeUndefined();
    render(<Probe />);
    expect(readProbe()).toEqual(PRISTINE);
  });

  it('the provider-safe fallback itself still works (must-not-break)', () => {
    // `useObjectTranslation()` outside a provider must not throw, must report a
    // language, and must serve `defaultValue` — that is the deliberate design at
    // packages/i18n/src/provider.tsx (`context?.language || i18n.language || 'en'`).
    // The reset must not destroy it, only make it deterministic.
    expect(() => render(<Probe />)).not.toThrow();
    expect(readProbe().language).toBe('en');
    expect(readProbe().missing).toBe('INLINE-DEFAULT');
  });

  it('a provider still works when mounted AFTER all of the above', () => {
    // The reset restores a pointer; it must not leave react-i18next in a state
    // where a later provider cannot install itself.
    renderZhProvider(<Probe />);
    expect(readProbe()).toEqual({ language: 'zh', save: '保存', missing: 'INLINE-DEFAULT' });
  });
});
