// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A read-only package's form designer field card describes no drag —
 * objectui#11924.
 *
 * The defect: dnd-kit's `useDraggable` writes `aria-describedby` onto every
 * card, pointing at the canvas's drag instructions ("To pick up a field, press
 * Space or Enter. …"), and `useSortable`'s `attributes` cannot take it away. A
 * read-only package's card has its sensors off and neither says nor looks
 * draggable (objectui#11781, objectui#11872), yet a screen reader still read it
 * how to drag it, in EN and in ZH.
 *
 * The instrument is the card's computed accessible description, through
 * jest-dom's `toHaveAccessibleDescription`, which follows `aria-describedby`
 * into the hidden instructions node. The writable control below proves the
 * instrument sees that node: a writable card's description IS the
 * instructions, in both locales.
 *
 * The instructions are pinned by KEY, resolved through the designer's table,
 * so a copy edit does not redden this file and a missing row does (`t` echoes
 * a missing key).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectFormDesigner } from './ObjectFormDesigner';
import { t, tFormat } from '../metadata-admin/i18n';

const INSTRUCTIONS_KEY = 'engine.studio.formDnd.instructions';

const DRAFT = {
  name: 'account',
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'phone', type: 'text', label: 'Phone', group: 'contact' },
    { name: 'email', type: 'text', label: 'Email', group: 'contact' },
  ],
  fieldGroups: [{ key: 'contact', label: 'Contact' }],
};
const LABELS = ['Name', 'Phone', 'Email'];

type Locale = 'en-US' | 'zh-CN';
const LOCALES: ReadonlyArray<readonly [Locale, 'en' | 'zh']> = [
  ['en-US', 'en'],
  ['zh-CN', 'zh'],
];

/** The row for `key` in `locale`, which must exist: `t` echoes a missing key. */
function row(key: string, locale: Locale): string {
  const text = t(key, locale);
  expect(text, `no ${locale} row for ${key}`).not.toBe(key);
  return text;
}

function renderDesigner({
  lang = 'en',
  readOnly = false,
  onSelectField = () => {},
}: { lang?: 'en' | 'zh'; readOnly?: boolean; onSelectField?: (name: string) => void } = {}) {
  const designer = (
    <ObjectFormDesigner
      draft={DRAFT}
      systemFieldNames={new Set()}
      onChange={() => {}}
      onSelectField={onSelectField}
      readOnly={readOnly}
    />
  );
  if (lang === 'en') return render(designer);
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  return render(<I18nProvider instance={zh}>{designer}</I18nProvider>);
}

/** Each field card, found by the accessible name the card itself carries. */
function cards(locale: Locale, readOnly: boolean): HTMLElement[] {
  const nameKey = readOnly ? 'engine.studio.designer.fieldAriaReadOnly' : 'engine.studio.designer.fieldAria';
  return LABELS.map((label) => screen.getByRole('button', { name: tFormat(nameKey, locale, { label }) }));
}

afterEach(cleanup);

describe('a read-only form designer card describes no drag (objectui#11924)', () => {
  it.each(LOCALES)('%s: a read-only card carries no drag instructions in its description', (locale, lang) => {
    renderDesigner({ lang, readOnly: true });
    const instructions = row(INSTRUCTIONS_KEY, locale);
    for (const card of cards(locale, true)) {
      expect(card).not.toHaveAttribute('aria-describedby');
      expect(card).not.toHaveAccessibleDescription(instructions);
      // Neither locale's instructions, so a fallback to the other row is red too.
      for (const [other] of LOCALES) {
        expect(card).not.toHaveAccessibleDescription(expect.stringContaining(row(INSTRUCTIONS_KEY, other)));
      }
    }
  });

  it.each(LOCALES)('control, %s: a writable card is described by the drag instructions', (locale, lang) => {
    renderDesigner({ lang });
    const instructions = row(INSTRUCTIONS_KEY, locale);
    for (const card of cards(locale, false)) {
      expect(card).toHaveAttribute('aria-describedby');
      expect(card).toHaveAccessibleDescription(instructions);
    }
  });

  it('control: a read-only card is still a focusable button that selects its field on click', () => {
    const onSelectField = vi.fn();
    renderDesigner({ readOnly: true, onSelectField });
    const phone = screen.getByRole('button', {
      name: tFormat('engine.studio.designer.fieldAriaReadOnly', 'en-US', { label: 'Phone' }),
    });
    expect(phone).toHaveAttribute('tabindex', '0');
    phone.focus();
    expect(phone).toHaveFocus();
    fireEvent.click(phone);
    expect(onSelectField).toHaveBeenCalledWith('phone');
  });
});
