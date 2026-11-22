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
 *  - Two parts: the business settings on top and "Developer options" last,
 *    expanded with no switch, holding the internal name, the access posture
 *    and the required permissions. Both parts are the ONE object inspector,
 *    mounted twice through its `split` prop; without `split` it is drawn whole,
 *    with no key small print, for every other host.
 *
 * The real `ObjectDefaultInspector` is registered for the whole file, so every
 * case reads the tab as the console draws it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { ObjectDefaultInspector } from '../metadata-admin/inspectors/ObjectDefaultInspector';

registerMetadataDefaultInspector('object', ObjectDefaultInspector);

const EN = await loadStudioCatalogue('en');
// Resident before any case, so the zh render below reads synchronously.
const ZH = await loadStudioCatalogue('zh');

const SETTINGS = 'engine.studio.settings.';
/** The inspector's strings this tab draws (its kind and section labels aside). */
const INSPECTOR_ON_TAB = 'designer.object.';

const draft = {
  name: 'leave_request',
  label: 'Leave request',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'select', label: 'Status' },
  },
};

function renderPanel(d: Record<string, unknown>, locale: 'en-US' | 'zh-CN' = 'en-US', onPatch = vi.fn()) {
  render(<ObjectSettingsPanel name="leave_request" draft={d} onPatch={onPatch} locale={locale} />);
  return onPatch;
}

/** Every key the tab writes, as its small print spells it. */
const SETTING_KEYS = [
  'label',
  'pluralLabel',
  'icon',
  'color',
  'description',
  'name',
  'access.default',
  'requiredPermissions',
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

/**
 * A key name in parentheses, ASCII or full-width: a camelCase, dotted or
 * snake_case token (`(nameField)`, `(enable.*)`), or one of the one-word
 * capability keys the titles used to carry (`(files)`). A plain word such as
 * `(default)` is prose, not a key.
 */
const PAREN_KEY = /[(（]\s*(?:[a-z]+[A-Z_.*][\w.*]*|files|feeds|activities|searchable|clone|master-detail)\s*[)）]/u;

describe('ObjectSettingsPanel — business wording (objectstack#36512)', () => {
  it.each([
    ['en', EN],
    ['zh', ZH],
  ] as const)('the %s catalogue: no settings string carries an ADR number, a rule code or a parenthesised key', (_lang, catalogue) => {
    const rows = Object.entries(catalogue).filter(([k]) => k.startsWith(SETTINGS) || k.startsWith(INSPECTOR_ON_TAB));
    // A floor, so an emptied family cannot pass over nothing.
    expect(rows.length).toBeGreaterThanOrEqual(60);
    const offending = rows.filter(
      ([, v]) =>
        /ADR-|security-owd-unset|snake_case|AND[- ]gate|AND 门|wildcard|通配|暴露姿态|必需能力/.test(v) || PAREN_KEY.test(v),
    );
    expect(offending).toEqual([]);
  });

  it.each([
    ['en-US', 'unset'],
    ['en-US', 'controlled_by_parent'],
    ['zh-CN', 'unset'],
    ['zh-CN', 'controlled_by_parent'],
  ] as const)('the rendered tab (%s, sharing %s) shows no ADR number', (locale, sharing) => {
    // A controlled-by-parent object that derives its one master, so the spec's
    // own refusal (its message is the spec's text, not this tab's) is not drawn.
    const cbp = {
      sharingModel: sharing,
      fields: { ...draft.fields, account: { type: 'master_detail', reference: 'crm_account', required: true } },
    };
    renderPanel(sharing === 'unset' ? draft : cbp, locale);
    expect(screen.queryByTestId('owd-cbp-refusal')).toBeNull();
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

describe('ObjectSettingsPanel — business settings first, developer options last (objectstack#36512)', () => {
  const sections = () => Array.from(document.querySelectorAll('section'));

  it('draws Developer options as the last section, expanded, holding the internal name, access and required permissions', () => {
    renderPanel(draft);
    const all = sections();
    const dev = screen.getByTestId('developer-options-section');
    expect(all[all.length - 1]).toBe(dev);
    expect(within(dev).getByText(t('engine.studio.settings.developer', 'en-US'))).toBeTruthy();
    // Expanded with no switch: nothing in it is a disclosure control (a
    // picker's own combobox aside).
    expect(dev.querySelector('[aria-expanded]:not([role="combobox"])')).toBeNull();
    expect(dev.querySelector('details')).toBeNull();
    expect(within(dev).getByTestId('object-name-input')).toBeTruthy();
    expect(within(dev).getByTestId('object-access-posture')).toBeTruthy();
    expect(within(dev).getByTestId('object-reqperms-all')).toBeTruthy();
    // The internal name of a created object is read-only.
    expect((within(dev).getByTestId('object-name-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps the business rows on top and out of Developer options', () => {
    renderPanel(draft);
    const basics = sections()[0];
    expect(within(basics).getByLabelText(t('designer.object.label', 'en-US'))).toBeTruthy();
    expect(within(basics).getByLabelText(t('designer.object.pluralLabel', 'en-US'))).toBeTruthy();
    expect(within(basics).getByLabelText(t('designer.object.description', 'en-US'))).toBeTruthy();
    expect(within(basics).queryByTestId('object-name-input')).toBeNull();
    expect(within(basics).queryByTestId('object-access-posture')).toBeNull();
    const dev = screen.getByTestId('developer-options-section');
    expect(within(dev).queryByLabelText(t('designer.object.label', 'en-US'))).toBeNull();
    // Each row is drawn once across the two mounts.
    expect(screen.getAllByTestId('object-name-input')).toHaveLength(1);
    expect(screen.getAllByTestId('object-access-posture')).toHaveLength(1);
  });

  it('names the internal-name input by its title alone', () => {
    renderPanel(draft);
    expect(screen.getByLabelText(t('designer.object.name', 'en-US'))).toBe(screen.getByTestId('object-name-input'));
  });

  it('a pick in Developer options writes the same patch it wrote before', async () => {
    const onPatch = renderPanel(draft);
    fireEvent.keyDown(screen.getByTestId('object-access-posture'), { key: 'ArrowDown' });
    const option = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .find((o) => o.textContent === t('designer.object.posture.private', 'en-US'));
    fireEvent.click(option!);
    expect(onPatch).toHaveBeenCalledWith({ access: { default: 'private' } });
  });
});

describe('ObjectDefaultInspector without split — every other host (objectstack#36512)', () => {
  it('draws the whole panel, with no key small print', () => {
    render(
      <ObjectDefaultInspector type="object" name="leave_request" draft={draft} onPatch={vi.fn()} readOnly={false} locale="en-US" />,
    );
    expect(screen.getByTestId('object-name-input')).toBeTruthy();
    expect(screen.getByTestId('object-access-posture')).toBeTruthy();
    expect(screen.getByLabelText(t('designer.object.label', 'en-US'))).toBeTruthy();
    expect(document.querySelector('[data-testid^="setting-key-"]')).toBeNull();
    expect(screen.queryByTestId('object-inspector-business')).toBeNull();
    expect(screen.queryByTestId('object-inspector-developer')).toBeNull();
  });
});
