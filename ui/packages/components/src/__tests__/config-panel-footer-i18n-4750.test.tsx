/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ConfigPanelRenderer`'s footer buttons speak the session language —
 * objectui#4750.
 *
 * `saveLabel` / `discardLabel` were English literals sitting in the component's
 * PARAMETER DEFAULTS (`saveLabel = 'Save'`, `discardLabel = 'Discard'`), and no
 * caller in the repo passes either prop. So the sticky footer that appears the
 * moment a config draft is dirty read `Save` / `Discard` in every locale, inside
 * panels whose every other string had already been routed through `t()`
 * (objectui#4748).
 *
 * ── Measured reverse-verification direction ──────────────────────────────
 * This file is RED before the fix and GREEN after: restoring the two parameter
 * defaults makes both locale cases render the English literals, which is
 * exactly what the assertions below name. The provider-less byte-identity leg
 * — GREEN on both sides, because the English bytes must not move — lives in
 * `config-panel-footer-no-provider-4750.test.tsx`.
 *
 * ── Two locales, chosen for what each can decide ──────────────────────────
 *  - **zh** — a non-Latin pack, where a value byte-identical to `en` is
 *    decidable evidence of an untranslated string.
 *  - **de** — a Latin pack, where identity CAN be genuine, so the assertions
 *    name the German words explicitly rather than merely checking "not
 *    English".
 *
 * Values are asserted as literals rather than read back out of the pack: a test
 * that resolves its expectation through the same table it is testing passes on
 * any pack, including an empty one.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` registers its instance as react-i18next's module-global default
 * and the registration survives unmount and `cleanup()`, so a "no provider"
 * assertion placed in THIS file would silently resolve against whichever
 * language ran last. That leg is a separate file, which mounts no provider at
 * all.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ConfigPanelRenderer } from '../custom/config-panel-renderer';
import type { ConfigPanelSchema } from '../types/config-panel';

afterEach(cleanup);

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

/** The footer only exists while the draft is dirty — that is the whole surface. */
function renderIn(language: string, over: Record<string, unknown> = {}) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
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
      />
    </I18nProvider>,
  );
}

const footerText = () => ({
  save: screen.getByTestId('config-panel-save').textContent?.trim(),
  discard: screen.getByTestId('config-panel-discard').textContent?.trim(),
});

describe('ConfigPanelRenderer footer — the defaults translate (objectui#4750)', () => {
  it('renders the Chinese words under zh', () => {
    renderIn('zh');

    expect(footerText()).toEqual({ save: '保存', discard: '放弃' });
    // Falsifier: the English literals this fix removed are gone, not merely
    // joined by translations somewhere else in the panel.
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('Discard')).toBeNull();
  });

  it('renders the German words under de', () => {
    renderIn('de');

    expect(footerText()).toEqual({ save: 'Speichern', discard: 'Verwerfen' });
  });

  it('never leaks a raw pack key', () => {
    renderIn('zh');

    expect(screen.queryByText('common.save')).toBeNull();
    expect(screen.queryByText('common.discard')).toBeNull();
  });
});

describe('ConfigPanelRenderer footer — an explicit prop still wins (objectui#4750)', () => {
  it('renders a caller-supplied label verbatim, untranslated, under zh', () => {
    renderIn('zh', { saveLabel: 'Apply', discardLabel: 'Reset' });

    expect(footerText()).toEqual({ save: 'Apply', discard: 'Reset' });
    // The pack words must not appear anywhere: a prop that merely won the
    // *button* while the default also rendered would be a different bug.
    expect(screen.queryByText('保存')).toBeNull();
    expect(screen.queryByText('放弃')).toBeNull();
  });

  it('lets each label be overridden independently — the other still translates', () => {
    renderIn('zh', { saveLabel: 'Apply' });

    expect(footerText()).toEqual({ save: 'Apply', discard: '放弃' });
  });

  it('treats an explicit empty string as a caller decision, not a missing prop', () => {
    // `??` and not `||`: a caller that deliberately blanks a label (icon-only
    // footer) gets a blank one. `||` would silently substitute the pack word.
    renderIn('zh', { saveLabel: '' });

    expect(footerText()).toEqual({ save: '', discard: '放弃' });
  });
});
