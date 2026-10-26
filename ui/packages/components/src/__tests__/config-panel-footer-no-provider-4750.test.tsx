/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ConfigPanelRenderer`'s footer still renders the SAME English bytes with no
 * `I18nProvider` mounted — objectui#4750.
 *
 * Routing a literal through `t()` without a working default is exactly how a
 * provider-less consumer breaks, and this primitive has them: embedded hosts
 * mount it bare, the preview gallery does, and so do this package's own
 * `config-panel-renderer.test.tsx` suites. A missing defaults-map row would
 * surface here as the raw key `common.save` / `common.discard` in the DOM.
 *
 * ── Measured reverse-verification direction ──────────────────────────────
 * GREEN before the fix and GREEN after — deliberately. The two labels replaced
 * were the literals `'Save'` and `'Discard'`, and the pack values and defaults
 * map are byte-identical to them, so no English byte moves. What this file
 * catches is the two ways that identity can be broken later: a defaults row
 * dropped or misspelled (the DOM assertions), and an `en` pack value edited out
 * from under the map (the pack assertions). Measured by emptying the defaults
 * map: the buttons then render the literal text `common.save` / `common.discard`
 * and the first case fails.
 *
 * The translated direction — the fix proper — is asserted in
 * `config-panel-footer-i18n-4750.test.tsx`.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, which registers that
 * instance as react-i18next's module-global default, and the registration
 * survives unmount and `cleanup()`. The moment any test in a file mounts an
 * `I18nProvider`, every later "no provider" render in that same file silently
 * resolves against that instance — a green-looking file asserting nothing about
 * the fallback. The `dom` project runs with `isolate: true`, so a file that
 * never mounts a provider gets a genuinely clean global. Keep it that way:
 * **do not import or mount `I18nProvider` here.**
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { en } from '@object-ui/i18n';
import { ConfigPanelRenderer } from '../custom/config-panel-renderer';
import type { ConfigPanelSchema } from '../types/config-panel';

afterEach(cleanup);

/**
 * The English the footer shipped BEFORE objectui#4750, frozen here as literals.
 * Read from nothing — a table sourced from the pack would agree with the pack
 * by construction and could not detect the pack moving.
 */
const PRE_4750_FOOTER_LITERALS = {
  save: 'Save',
  discard: 'Discard',
} as const;

const schema: ConfigPanelSchema = {
  breadcrumb: ['Settings'],
  sections: [
    {
      key: 'basic',
      title: 'Basic',
      fields: [{ key: 'name', label: 'Name', type: 'input' }],
    },
  ],
};

function renderPanel(over: Record<string, unknown> = {}) {
  return render(
    <ConfigPanelRenderer
      open
      onClose={vi.fn()}
      schema={schema}
      draft={{ name: 'x' }}
      isDirty
      onFieldChange={vi.fn()}
      onSave={vi.fn()}
      onDiscard={vi.fn()}
      {...over}
    />,
  );
}

const footerText = () => ({
  save: screen.getByTestId('config-panel-save').textContent?.trim(),
  discard: screen.getByTestId('config-panel-discard').textContent?.trim(),
});

describe('ConfigPanelRenderer footer — provider-less bytes are unchanged (objectui#4750)', () => {
  it('renders the pre-change English literals, never a raw key', () => {
    renderPanel();

    expect(footerText()).toEqual({
      save: PRE_4750_FOOTER_LITERALS.save,
      discard: PRE_4750_FOOTER_LITERALS.discard,
    });
    expect(screen.queryByText('common.save')).toBeNull();
    expect(screen.queryByText('common.discard')).toBeNull();
  });

  it('still lets an explicit prop win with no provider mounted', () => {
    renderPanel({ saveLabel: 'Apply', discardLabel: 'Reset' });

    expect(footerText()).toEqual({ save: 'Apply', discard: 'Reset' });
  });
});

describe('the `en` pack says what the footer used to say (objectui#4750)', () => {
  it('carries the two keys with the replaced literals as their values', () => {
    // Positive byte-identity, both keys: the defaults map served without a
    // provider and the `en` pack served with one must be the same string, or
    // the same button reads two different words depending on the host.
    expect(en.common.save).toBe(PRE_4750_FOOTER_LITERALS.save);
    expect(en.common.discard).toBe(PRE_4750_FOOTER_LITERALS.discard);
  });

  it('keeps `common.discard` byte-identical to the spelling the packs already agreed on', () => {
    // `common.discard` is the key this change ADDED. Its value is the majority
    // spelling already in the packs — `form.discard` (plugin-form's discard
    // dialog) and `console.settingsView.discard` — which agree in all ten. The
    // third older spelling, `console.objectView.discard`, deliberately is NOT
    // asserted equal: it diverges in zh/ko/fr, which is why the shared
    // component got its own key instead of borrowing one.
    expect(en.common.discard).toBe(en.form.discard);
    expect(en.common.discard).toBe(en.console.settingsView.discard);
  });
});
