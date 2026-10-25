// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13148 — a form designer field card names its type the way the rest
 * of Studio does.
 *
 * The defect: `SortableField` rendered the field's spec type id as the card's
 * type tag, so a Picklist field read "Status SELECT" on the canvas while the
 * type picker (the type menu, and the Type control in the field inspector)
 * called the same type "Picklist". The tag now reads the type's display name
 * through `fieldTypeName`, the catalog's `engine.fieldType.ID` row.
 *
 * The named cases compare the card with the type picker AS RENDERED, so what
 * is pinned is "the two agree", not a copy of the string table. The tag keeps
 * the upper-case styling objectui#12451 gave it: its text is the display name,
 * drawn in capitals.
 *
 * Alongside: the control skeleton and the wide-widget span still key on the
 * spec id; the label, the required star and the selected colour are as they
 * were; and, the one CONTROL that holds with the fix reverted, a type the
 * catalog does not list is shown as itself.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { isWideFieldType } from '@object-ui/plugin-form';
import { ObjectFormDesigner } from './ObjectFormDesigner';
import { toFormFieldType } from './formFieldType';
import { FieldTypePicker } from '../metadata-admin/inspectors/FieldTypePicker';
import { FIELD_TYPE_META, type FieldTypeId } from '../metadata-admin/previews/field-types';
import { fieldTypeName } from '../metadata-admin/previews/fieldTypeName';
import { t, tFormat } from '../metadata-admin/i18n';

afterEach(cleanup);

type Lang = 'en' | 'zh';
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;

/** The card's Actual (a Picklist "Status"), and its Expected's User, Lookup and Date. */
const FIELDS = [
  { name: 'status', type: 'select', label: 'Status', required: true },
  { name: 'owner', type: 'user', label: 'Owner' },
  { name: 'account', type: 'lookup', label: 'Account' },
  { name: 'close_date', type: 'date', label: 'Close Date' },
];
const UNLISTED = { name: 'legacy', type: 'legacy_widget', label: 'Legacy' };

function inLang(lang: Lang, node: React.ReactElement): React.ReactElement {
  if (lang === 'en') return node;
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  return <I18nProvider instance={zh}>{node}</I18nProvider>;
}

function renderDesigner(
  fields: Array<Record<string, unknown>>,
  { lang = 'en', selectedField }: { lang?: Lang; selectedField?: string } = {},
) {
  render(
    inLang(
      lang,
      <ObjectFormDesigner
        draft={{ name: 'crm_deal', fields }}
        systemFieldNames={new Set()}
        onChange={() => {}}
        onSelectField={() => {}}
        selectedField={selectedField}
      />,
    ),
  );
}

/** The card for `label`, by the accessible name the card itself carries. */
function card(label: string, lang: Lang = 'en'): HTMLElement {
  return screen.getByRole('button', {
    name: tFormat('engine.studio.designer.fieldAria', LOCALE[lang], { label }),
  });
}

/** What the type picker shows for `type`: its trigger's text, as rendered. */
function pickerName(type: string, lang: Lang = 'en'): string {
  const { unmount } = render(inLang(lang, <FieldTypePicker label="Type" value={type} onCommit={() => {}} />));
  const text = screen.getByRole('combobox', { name: 'Type' }).textContent ?? '';
  unmount();
  return text;
}

describe('form designer field card type tag (objectui#13148)', () => {
  it('en-US: each card reads the name the type picker shows, never the spec id', () => {
    const names = Object.fromEntries(FIELDS.map((f) => [f.type, pickerName(f.type)]));
    // Not vacuous: the picker itself names a Picklist by its row, not its id.
    expect(names.select).toBe(t('engine.fieldType.select', 'en-US'));
    expect(names.select).not.toBe('select');

    renderDesigner(FIELDS);
    for (const f of FIELDS) {
      const c = card(f.label);
      expect(within(c).getByText(names[f.type])).toBeInTheDocument();
      expect(within(c).queryByText(f.type)).toBeNull();
      expect(within(c).queryByText(f.type.toUpperCase())).toBeNull();
    }
  });

  it('zh-CN: the card reads the zh name the type picker shows', () => {
    const zhName = pickerName('select', 'zh');
    expect(zhName).toBe(t('engine.fieldType.select', 'zh-CN'));
    expect(zhName).not.toBe(t('engine.fieldType.select', 'en-US'));

    renderDesigner(FIELDS, { lang: 'zh' });
    const c = card('Status', 'zh');
    expect(within(c).getByText(zhName)).toBeInTheDocument();
    expect(within(c).queryByText('select')).toBeNull();
  });

  it('every catalog type reads its own row, and its span still keys on the spec id', () => {
    const ids = Object.keys(FIELD_TYPE_META) as FieldTypeId[];
    renderDesigner(ids.map((id) => ({ name: `f_${id}`, type: id, label: `Field ${id}` })));
    for (const id of ids) {
      const name = t(`engine.fieldType.${id}`, 'en-US');
      expect(name, `no en-US row for ${id}`).not.toBe(`engine.fieldType.${id}`);
      const c = card(`Field ${id}`);
      expect(within(c).getByText(name)).toBeInTheDocument();
      // CONTROL — the wide-widget span reads the spec id, not the name.
      expect(c.className.split(/\s+/).includes('col-span-full'), id).toBe(isWideFieldType(toFormFieldType(id)));
    }
  });

  it('CONTROL — a type the catalog does not list is shown as itself', () => {
    renderDesigner([...FIELDS, UNLISTED]);
    expect(within(card(UNLISTED.label)).getByText(UNLISTED.type)).toBeInTheDocument();
    // An inherited object key is not a catalog row either.
    expect(fieldTypeName('toString', 'en-US')).toBe('toString');
  });

  // The skeleton, label and star halves hold with or without the fix; the
  // selected-colour half finds the tag by its name, so it needs the fix.
  it('the skeletons, label, required star and selected colour are as they were', () => {
    renderDesigner(FIELDS, { selectedField: 'status' });
    const status = card('Status');
    expect(status).toHaveTextContent(t('engine.studio.designer.select', 'en-US'));
    expect(within(status).getByText('Status')).toBeInTheDocument();
    expect(status).toHaveTextContent('*');
    expect(within(status).getByText(t('engine.fieldType.select', 'en-US'))).toHaveClass('text-primary');
    for (const label of ['Owner', 'Account']) {
      expect(card(label)).toHaveTextContent(t('engine.studio.designer.search', 'en-US'));
    }
    expect(card('Close Date')).toHaveTextContent(t('engine.studio.designer.pickDate', 'en-US'));
    expect(within(card('Owner')).getByText(t('engine.fieldType.user', 'en-US'))).toHaveClass('text-muted-foreground');
  });
});
