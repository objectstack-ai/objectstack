/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36512 — the object Settings tab speaks the author's language.
 *
 *  - No ADR number or internal rule code is shown, in either catalogue the
 *    studio namespace ships (`en`, `zh`; every other language falls back to
 *    `en`).
 *  - A setting's title carries no key name in parentheses; the key it writes
 *    is small print beside the title (`SettingKey`), whole-selectable, and
 *    OUTSIDE the control's label: selecting it neither opens a picker nor
 *    flips a switch, and the control is still named by its title.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

const EN = await loadStudioCatalogue('en');
// Resident before any case, so the zh render below reads synchronously.
const ZH = await loadStudioCatalogue('zh');

const SETTINGS = 'engine.studio.settings.';

const draft = {
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'select', label: 'Status' },
  },
};

function renderPanel(d: Record<string, unknown>, locale: 'en-US' | 'zh-CN' = 'en-US', onPatch = vi.fn()) {
  render(<ObjectSettingsPanel name="leave_request" draft={d} onPatch={onPatch} locale={locale} />);
  return onPatch;
}

/** Every key the panel writes, as its small print spells it. */
const SETTING_KEYS = [
  'sharingModel',
  'nameField',
  'stageField',
  'highlightFields',
  'relatedLists',
  'enable.trackHistory',
  'enable.files',
  'enable.feeds',
  'enable.activities',
  'enable.searchable',
  'enable.clone',
] as const;

/** A key name in parentheses, ASCII or full-width: `(nameField)`, `(enable.*)`, `(files)`. */
const PAREN_KEY = /[(（]\s*[A-Za-z][\w.*]*\s*[)）]/u;

describe('ObjectSettingsPanel — business wording (objectstack#36512)', () => {
  it.each([
    ['en', EN],
    ['zh', ZH],
  ] as const)('the %s catalogue: no settings string carries an ADR number, a rule code or a parenthesised key', (_lang, catalogue) => {
    const rows = Object.entries(catalogue).filter(([k]) => k.startsWith(SETTINGS));
    // A floor, so an emptied family cannot pass over nothing.
    expect(rows.length).toBeGreaterThanOrEqual(35);
    const offending = rows.filter(([, v]) => /ADR-|security-owd-unset/.test(v) || PAREN_KEY.test(v));
    expect(offending).toEqual([]);
  });

  it.each([
    ['en-US', 'unset'],
    ['en-US', 'controlled_by_parent'],
    ['zh-CN', 'unset'],
    ['zh-CN', 'controlled_by_parent'],
  ] as const)('the rendered tab (%s, sharing %s) shows no ADR number', (locale, sharing) => {
    renderPanel(sharing === 'unset' ? draft : { ...draft, sharingModel: sharing }, locale);
    expect(document.body.textContent).not.toMatch(/ADR/);
    expect(document.body.textContent).not.toMatch(/security-owd-unset/);
  });

  it('draws each key as whole-selectable small print beside its title, outside the label', () => {
    renderPanel(draft);
    for (const key of SETTING_KEYS) {
      const chip = screen.getByTestId(`setting-key-${key}`);
      expect(chip.textContent).toBe(key);
      expect(chip.className).toMatch(/select-all/);
      expect(chip.className).toMatch(/font-mono/);
      expect(chip.closest('label')).toBeNull();
    }
  });

  it('names each picker and switch by its title alone, and the title carries no key', () => {
    renderPanel(draft);
    const named: Array<[string, string]> = [
      ['engine.studio.settings.sharingModel', 'owd-internal-select'],
      ['engine.studio.settings.nameField', 'name-field-select'],
      ['engine.studio.settings.stageField', 'stage-field-select'],
    ];
    for (const [titleKey, testId] of named) {
      const title = t(titleKey, 'en-US');
      expect(title).not.toMatch(PAREN_KEY);
      expect(screen.getByLabelText(title)).toBe(screen.getByTestId(testId));
    }
    const history = screen.getByLabelText(t('engine.studio.settings.capTrackHistory', 'en-US'), { exact: false });
    expect(history).toBe(screen.getByTestId('cap-trackHistory'));
  });

  it('selecting a key writes nothing: a click on a switch\'s key does not flip the switch', () => {
    const onPatch = renderPanel(draft);
    fireEvent.click(screen.getByTestId('setting-key-enable.feeds'));
    fireEvent.click(screen.getByTestId('setting-key-nameField'));
    expect(onPatch).not.toHaveBeenCalled();
    expect((screen.getByTestId('cap-feeds') as HTMLInputElement).checked).toBe(true);
    // The title still flips it, as the whole row did before.
    fireEvent.click(screen.getByText(t('engine.studio.settings.capFeeds', 'en-US')));
    expect(onPatch).toHaveBeenCalledWith({ enable: { feeds: false } });
  });
});
