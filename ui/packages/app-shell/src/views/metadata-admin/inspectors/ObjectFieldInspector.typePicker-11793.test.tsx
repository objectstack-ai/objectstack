// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11793 — the field inspector's *Type* control is a searchable
 * picker grouped by category, with an icon and a one-line description per
 * type, where it was one flat select of every type.
 *
 * The inspector is the real one, mounted in a host that applies each
 * `onPatch` the way the designers do (`{ ...draft, ...patch }`), so every
 * assertion about a choice reads the field the next save would carry.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldSchema } from '@objectstack/spec/data';
import { TYPES_BY_CATEGORY } from '../previews/field-types';
import { t, type SupportedLocale } from '../i18n';

type Row = Record<string, unknown>;

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  const client = { list: async () => [], listDrafts: async () => [] };
  return { ...mod, useMetadataClient: () => client };
});

vi.mock('../previews/useObjectFields', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../previews/useObjectFields')>();
  return { ...mod, useObjectFields: () => ({ fields: [], loading: false, error: null }) };
});

import { ObjectFieldInspector } from './ObjectFieldInspector';

beforeEach(() => {
  // Radix reads pointer capture, which the DOM double does not implement.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
});

afterEach(cleanup);

const ALL_TYPES = TYPES_BY_CATEGORY.flatMap((g) => g.types);

/** The inspector in a host that applies its patches, as both designers do. */
function mount(
  fields: Record<string, Row>,
  selected: string,
  { locale = 'en-US', readOnly = false }: { locale?: SupportedLocale; readOnly?: boolean } = {},
) {
  let latest: Row = { name: 'acme_account', fields };
  const patches: Row[] = [];
  function Host() {
    const [draft, setDraft] = React.useState<Row>(latest);
    return (
      <ObjectFieldInspector
        type="object"
        name="acme_account"
        draft={draft}
        selection={{ kind: 'field', id: selected }}
        onPatch={(patch) => {
          patches.push(patch);
          setDraft((d) => {
            latest = { ...d, ...patch };
            return latest;
          });
        }}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={readOnly}
        locale={locale}
      />
    );
  }
  render(<Host />);
  return { field: () => (latest.fields as Record<string, Row>)[selected], patches };
}

const typeTrigger = (locale: SupportedLocale = 'en-US') =>
  screen.getByRole('combobox', { name: t('designer.field.type', locale) });

async function openPicker(locale: SupportedLocale = 'en-US') {
  await userEvent.click(typeTrigger(locale));
  return screen.findByRole('listbox', { name: t('designer.field.type', locale) });
}

const optionNames = (list: HTMLElement) =>
  within(list).queryAllByRole('option').map((o) => o.getAttribute('data-field-type'));

describe('ObjectFieldInspector — the Type picker (objectui#11793)', () => {
  it('the trigger shows the field\'s type by name with its icon, and the list marks it as the current one', async () => {
    mount({ owner: { type: 'lookup', label: 'Owner', reference: 'user' } }, 'owner');
    const trigger = typeTrigger();
    expect(trigger).toHaveTextContent('Lookup');
    expect(trigger.querySelectorAll('svg').length, 'the type icon and the chevron').toBe(2);

    const list = await openPicker();
    const current = within(list).getByRole('option', { name: 'Lookup' });
    expect(current).toHaveAttribute('data-current');
    expect(list.querySelectorAll('[data-current]')).toHaveLength(1);
  });

  it('lists every catalog type once, under its category\'s heading, in catalog order, each with an icon and its description', async () => {
    mount({ title: { type: 'text', label: 'Title' } }, 'title');
    const list = await openPicker();

    const groups = within(list).getAllByRole('group');
    expect(groups.map((g) => within(g).getAllByRole('option').length)).toEqual(
      TYPES_BY_CATEGORY.map((g) => g.types.length),
    );
    TYPES_BY_CATEGORY.forEach((g, i) => {
      expect(groups[i]).toHaveAccessibleName(t(`engine.fieldCategory.${g.category}`, 'en-US'));
    });

    expect(optionNames(list)).toEqual(ALL_TYPES);
    for (const id of ALL_TYPES) {
      const option = list.querySelector(`[role="option"][data-field-type="${id}"]`) as HTMLElement;
      expect(option).toHaveAccessibleName(t(`engine.fieldType.${id}`, 'en-US'));
      expect(option).toHaveAccessibleDescription(t(`engine.fieldTypeDesc.${id}`, 'en-US'));
      expect(option.querySelector('svg'), `${id}: an icon`).not.toBeNull();
    }
  });

  it('typing "look" finds Lookup and narrows the list to it', async () => {
    mount({ title: { type: 'text', label: 'Title' } }, 'title');
    const list = await openPicker();
    await userEvent.type(screen.getByRole('combobox', { name: 'Search field type…' }), 'look');

    expect(optionNames(list)).toEqual(['lookup']);
    expect(within(list).getAllByRole('group')).toHaveLength(1);
    expect(within(list).getByRole('group')).toHaveAccessibleName('Relation');
  });

  it('the search also matches a category by name and a type by its id', async () => {
    mount({ title: { type: 'text', label: 'Title' } }, 'title');
    const list = await openPicker();
    const search = screen.getByRole('combobox', { name: 'Search field type…' });

    await userEvent.type(search, 'media');
    expect(optionNames(list)).toEqual(TYPES_BY_CATEGORY.find((g) => g.category === 'media')!.types);

    await userEvent.clear(search);
    await userEvent.type(search, 'master_detail');
    expect(optionNames(list)).toEqual(['master_detail']);

    await userEvent.clear(search);
    await userEvent.type(search, 'no such type');
    expect(optionNames(list)).toEqual([]);
    expect(list).toHaveTextContent(t('designer.canvas.noMatchingTypes', 'en-US'));
  });

  it('choosing a type retypes the field with that type\'s id, and the field is one the door accepts', async () => {
    const { field } = mount({ title: { type: 'text', label: 'Title' } }, 'title');
    const list = await openPicker();
    await userEvent.click(within(list).getByRole('option', { name: 'Email' }));

    expect(field()).toEqual({ type: 'email', label: 'Title' });
    expect(FieldSchema.safeParse(field()).success).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(typeTrigger()).toHaveTextContent('Email');
  });

  it('Enter after a search chooses the first match', async () => {
    const { field } = mount({ title: { type: 'text', label: 'Title' } }, 'title');
    await openPicker();
    await userEvent.type(screen.getByRole('combobox', { name: 'Search field type…' }), 'curr{Enter}');

    expect(field()).toEqual({ type: 'currency', label: 'Title' });
  });

  it('a retype goes through the inspector\'s retype rule: a picklist binding is dropped on a type that cannot name one', async () => {
    const { field } = mount({ tier: { type: 'select', label: 'Tier', picklist: 'acme_tier' } }, 'tier');
    const list = await openPicker();
    await userEvent.click(within(list).getByRole('option', { name: 'Number' }));

    expect(field()).toEqual({ type: 'number', label: 'Tier' });
  });

  it('re-choosing the current type writes nothing', async () => {
    const { patches } = mount({ title: { type: 'text', label: 'Title' } }, 'title');
    const list = await openPicker();
    await userEvent.click(within(list).getByRole('option', { name: 'Text' }));

    expect(patches).toEqual([]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a read-only field\'s Type control is disabled', async () => {
    mount({ title: { type: 'text', label: 'Title' } }, 'title', { readOnly: true });
    expect(typeTrigger()).toBeDisabled();
    await userEvent.click(typeTrigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a stored type the catalog does not list is shown flagged, never as blank or as another type', () => {
    mount({ legacy: { type: 'legacy_widget', label: 'Legacy' } }, 'legacy');
    expect(typeTrigger()).toHaveTextContent(/^legacy_widget \(not found\)$/);
  });

  it('zh: the names, the category headings and the descriptions are the zh rows, and an English word still finds a type', async () => {
    mount({ title: { type: 'text', label: 'Title' } }, 'title', { locale: 'zh-CN' });
    expect(typeTrigger('zh-CN')).toHaveTextContent(t('engine.fieldType.text', 'zh-CN'));

    const list = await openPicker('zh-CN');
    const lookup = list.querySelector('[role="option"][data-field-type="lookup"]') as HTMLElement;
    expect(lookup).toHaveAccessibleName(t('engine.fieldType.lookup', 'zh-CN'));
    expect(lookup).toHaveAccessibleDescription(t('engine.fieldTypeDesc.lookup', 'zh-CN'));
    expect(within(list).getAllByRole('group')[0]).toHaveAccessibleName(t('engine.fieldCategory.text', 'zh-CN'));

    await userEvent.type(screen.getByRole('combobox', { name: t('designer.canvas.searchFieldType', 'zh-CN') }), 'lookup');
    expect(optionNames(list)).toEqual(['lookup']);
  });

  it('every catalog type has a description row in both tables, and none is the English row read back in zh', () => {
    for (const id of ALL_TYPES) {
      const key = `engine.fieldTypeDesc.${id}`;
      const en = t(key, 'en-US');
      const zh = t(key, 'zh-CN');
      expect(en, `${key}: en row`).not.toBe(key);
      expect(zh, `${key}: zh row`).not.toBe(key);
      expect(zh, `${key}: zh is not the en row`).not.toBe(en);
    }
  });
});
