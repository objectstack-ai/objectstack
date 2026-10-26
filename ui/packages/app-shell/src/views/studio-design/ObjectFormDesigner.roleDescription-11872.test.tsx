// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A form designer field card's `aria-roledescription` speaks the author's
 * locale — objectui#11872.
 *
 * The defect: `SortableField` called `useSortable` with no `attributes`, so
 * dnd-kit wrote its own default, the English `sortable`, onto every card in
 * every locale, and a screen reader read it when the card took focus. The role
 * now comes from the designer's engine table, read through the same `t()` the
 * card's `aria-label` uses.
 *
 * A read-only package's card (objectui#11781) neither says nor looks
 * draggable, so it carries no role description: its value is blank, which ARIA
 * does not expose, and the card reads as the plain button it is.
 *
 * The wording is pinned by KEY, resolved through the table, so a copy edit
 * does not redden this file and a missing row does (`t` echoes a missing key).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectFormDesigner } from './ObjectFormDesigner';
import { t, tFormat } from '../metadata-admin/i18n';

const ROLE_KEY = 'engine.studio.designer.fieldRole';
/** dnd-kit's own defaults: `useSortable`'s, and `useDraggable`'s under it. */
const LIBRARY_DEFAULTS = ['sortable', 'draggable'];

const DRAFT = {
  name: 'account',
  fields: [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'phone', type: 'text', label: 'Phone', group: 'contact' },
    { name: 'email', type: 'text', label: 'Email', group: 'contact' },
  ],
  fieldGroups: [
    { key: 'contact', label: 'Contact' },
    { key: 'empty_group', label: 'Empty group' },
  ],
};
const LABELS = ['Name', 'Phone', 'Email'];

/** The row for `key` in `locale`, which must exist: `t` echoes a missing key. */
function row(key: string, locale: 'en-US' | 'zh-CN'): string {
  const text = t(key, locale);
  expect(text, `no ${locale} row for ${key}`).not.toBe(key);
  return text;
}

function renderDesigner({ lang = 'en', readOnly = false }: { lang?: 'en' | 'zh'; readOnly?: boolean } = {}) {
  const designer = (
    <ObjectFormDesigner
      draft={DRAFT}
      systemFieldNames={new Set()}
      onChange={() => {}}
      onSelectField={() => {}}
      readOnly={readOnly}
    />
  );
  if (lang === 'en') return render(designer);
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  return render(<I18nProvider instance={zh}>{designer}</I18nProvider>);
}

/** Each field card, found by the accessible name the card itself carries. */
function cards(locale: 'en-US' | 'zh-CN', readOnly = false): HTMLElement[] {
  const nameKey = readOnly ? 'engine.studio.designer.fieldAriaReadOnly' : 'engine.studio.designer.fieldAria';
  return LABELS.map((label) => screen.getByRole('button', { name: tFormat(nameKey, locale, { label }) }));
}

afterEach(cleanup);

describe('form designer field card role description (objectui#11872)', () => {
  it('en-US: every field card is announced with the localized role, never dnd-kit\'s English default', () => {
    renderDesigner();
    const role = row(ROLE_KEY, 'en-US');
    for (const card of cards('en-US')) {
      expect(card).toHaveAttribute('aria-roledescription', role);
      expect(LIBRARY_DEFAULTS).not.toContain(card.getAttribute('aria-roledescription'));
    }
  });

  it('zh-CN: every field card is announced with the zh row, not the en one and not `sortable`', () => {
    renderDesigner({ lang: 'zh' });
    const role = row(ROLE_KEY, 'zh-CN');
    expect(role).not.toBe(row(ROLE_KEY, 'en-US'));
    for (const card of cards('zh-CN')) {
      expect(card).toHaveAttribute('aria-roledescription', role);
      expect(LIBRARY_DEFAULTS).not.toContain(card.getAttribute('aria-roledescription'));
    }
  });

  it('read-only: a card that cannot be dragged carries no role description, and stays a button', () => {
    renderDesigner({ readOnly: true });
    const writableRole = row(ROLE_KEY, 'en-US');
    for (const card of cards('en-US', true)) {
      const value = card.getAttribute('aria-roledescription') ?? '';
      // Blank, so not exposed (WAI-ARIA 1.2, aria-roledescription); the read
      // is the native role, which `getByRole('button')` above already found.
      expect(value.trim()).toBe('');
      expect(value).not.toBe(writableRole);
    }
  });

  it('the group sections are drop zones only: no element but a field card carries a role description', () => {
    const { container } = renderDesigner();
    const described = Array.from(container.querySelectorAll('[aria-roledescription]'));
    expect(described).toHaveLength(LABELS.length);
    expect(new Set(described)).toEqual(new Set(cards('en-US')));
  });
});
