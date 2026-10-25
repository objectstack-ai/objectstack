/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A boolean the viewer cannot edit reads as a WORD in `record:details`, not as
 * a disabled checkbox (objectui#12933).
 *
 * The record page drew every boolean row through `BooleanCellRenderer`, the
 * grid's checkbox face. On a field the viewer cannot change, that disabled box
 * reads as a setting that refuses the click. A read-only row now draws the
 * locale's word for the value through `useBooleanValueLabel` (`common.yes` /
 * `common.no`, objectui#11689), the pair every read-only boolean face reads.
 *
 * Pinned:
 *  - read-only by the VIEW field's `readonly`, and separately by the OBJECT
 *    definition's `readonly`, draws the word for `true` and for `false`, in
 *    `en` and `zh-CN`, with no checkbox in the row;
 *  - an editable boolean keeps today's checkbox face;
 *  - a value that is not a boolean on a read-only boolean row keeps the shared
 *    "No value" affordance (objectui#8582): it is never read as `false`.
 *
 * Rendered through a REAL `I18nProvider` over the real packs.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';

afterEach(cleanup);

type ReadonlyOn = 'view' | 'object' | 'none';

const sectionFor = (readonlyOn: ReadonlyOn): DetailViewSection =>
  ({
    title: 'Access',
    fields: [
      { name: 'sso_enabled', label: 'SSO Enabled', ...(readonlyOn === 'view' ? { readonly: true } : {}) },
      { name: 'mfa_required', label: 'MFA Required', ...(readonlyOn === 'view' ? { readonly: true } : {}) },
      { name: 'region', label: 'Region' },
    ],
  }) as DetailViewSection;

const objectSchemaFor = (readonlyOn: ReadonlyOn) => ({
  fields: {
    sso_enabled: { type: 'boolean', label: 'SSO Enabled', ...(readonlyOn === 'object' ? { readonly: true } : {}) },
    mfa_required: { type: 'toggle', label: 'MFA Required', ...(readonlyOn === 'object' ? { readonly: true } : {}) },
    region: { type: 'text', label: 'Region' },
  },
});

const renderSection = (
  readonlyOn: ReadonlyOn,
  data: Record<string, unknown>,
  language: string | null = null,
) => {
  const ui = (
    <DetailSection section={sectionFor(readonlyOn)} data={data} objectSchema={objectSchemaFor(readonlyOn)} />
  );
  return language === null
    ? render(ui)
    : render(
        <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
          {ui}
        </I18nProvider>,
      );
};

/** The row's container, anchored on the field LABEL (never on the word under test). */
const rowOf = (label: string): HTMLElement => {
  const labelEl = screen.queryByText(label);
  expect(labelEl, `CONTROL: a row labelled "${label}" is on screen`).not.toBeNull();
  return (labelEl as HTMLElement).parentElement as HTMLElement;
};
const valueText = (label: string) => rowOf(label).textContent?.replace(label, '');
const checkboxIn = (label: string) => rowOf(label).querySelector('[role="checkbox"]');

const DATA = { sso_enabled: true, mfa_required: false, region: 'eu-west-1' };

describe.each<[ReadonlyOn, string]>([
  ['view', 'the view field'],
  ['object', 'the object definition field'],
])('a read-only boolean (readonly on %s) reads as text (objectui#12933)', (readonlyOn) => {
  it('en: the word for true and for false, with no checkbox', () => {
    renderSection(readonlyOn, DATA, 'en');
    // CONTROL: the section drew a real non-boolean value.
    expect(valueText('Region')).toBe('eu-west-1');
    expect(valueText('SSO Enabled')).toBe('Yes');
    expect(valueText('MFA Required')).toBe('No');
    expect(checkboxIn('SSO Enabled'), 'no checkbox on the read-only true row').toBeNull();
    expect(checkboxIn('MFA Required'), 'no checkbox on the read-only false row').toBeNull();
  });

  it('zh-CN: the word for true and for false, with no checkbox', () => {
    renderSection(readonlyOn, DATA, 'zh-CN');
    expect(valueText('Region')).toBe('eu-west-1');
    expect(valueText('SSO Enabled')).toBe('是');
    expect(valueText('MFA Required')).toBe('否');
    expect(checkboxIn('SSO Enabled')).toBeNull();
    expect(checkboxIn('MFA Required')).toBeNull();
  });

  it('a non-boolean value keeps the shared "No value" affordance, never read as false', () => {
    renderSection(readonlyOn, { sso_enabled: 'false', mfa_required: 0, region: 'eu-west-1' }, 'en');
    for (const label of ['SSO Enabled', 'MFA Required']) {
      expect(rowOf(label).querySelector('[data-slot="empty-value"]'), `"${label}" draws "No value"`).not.toBeNull();
      expect(valueText(label), `"${label}" draws no word`).not.toMatch(/Yes|No$/);
      expect(checkboxIn(label)).toBeNull();
    }
  });
});

describe('an editable boolean keeps today\'s face (objectui#12933)', () => {
  it('draws the checkbox, checked for true and unchecked for false, and no word', () => {
    renderSection('none', DATA, 'en');
    const on = checkboxIn('SSO Enabled');
    const off = checkboxIn('MFA Required');
    expect(on, 'the editable true row keeps its checkbox').not.toBeNull();
    expect(off, 'the editable false row keeps its checkbox').not.toBeNull();
    expect(on!.getAttribute('data-state')).toBe('checked');
    expect(off!.getAttribute('data-state')).toBe('unchecked');
    expect(valueText('SSO Enabled')).toBe('');
    expect(valueText('MFA Required')).toBe('');
  });
});
