// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The field inspector authors `referenceNameVisible` (objectstack#29629), the
 * declared name exposure of objectstack#29171 (ruling 6574398310, letter B):
 * a reader of the record may see the referenced record's name, as text with
 * no link, when they cannot open that record.
 *
 *  - The toggle is offered on `lookup` and `user` only, the two types
 *    `FieldSchema` accepts the key on. Checking it writes `true`; clearing it
 *    removes the key, so the field carries no `referenceNameVisible` at all.
 *  - A `user` field's target is always `sys_user`: the section opens for the
 *    toggle and offers none of the lookup picker controls.
 *  - The spec refuses the key, `false` included, on every other type, so a
 *    retype away from `lookup` / `user` removes it; `lookup` → `user` keeps it.
 *
 * Every write case ends at the written field's own keys and at `FieldSchema`,
 * never at "it rendered".
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldSchema } from '@objectstack/spec/data';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [{ name: 'vendor', label: 'Vendor' }];
  const get = async (_type: string, name: string) =>
    name === 'vendor' ? { name, fields: { name: { type: 'text', label: 'Name' } } } : null;
  const client = {
    get,
    withPreviewDrafts: (_on: boolean) => ({ list: async (_type: string) => CATALOG, get }),
    list: async (_type: string) => CATALOG,
    listDrafts: async () => [] as unknown[],
  };
  return { client };
});
vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { t, type SupportedLocale } from '../i18n';

// The zh case reads the lazy `studio` catalogue; load it at import so no
// assertion races the loader.
await loadStudioCatalogue('zh');

afterEach(cleanup);

type Def = Record<string, unknown>;

const LABEL = t('designer.field.lookup.referenceNameVisible', 'en-US');
const HELP = t('designer.field.lookup.referenceNameVisible.help', 'en-US');

/** A host that feeds each patch back, as Studio's draft does. */
function renderField(def: Def, opts: { locale?: SupportedLocale } = {}) {
  const onPatch = vi.fn();
  const initial: Record<string, unknown> = {
    name: 'po',
    label: 'Purchase order',
    fields: { title: { type: 'text', label: 'Title' }, party: def },
  };
  function Host() {
    const [draft, setDraft] = React.useState(initial);
    return (
      <ObjectFieldInspector
        type="object"
        name="po"
        draft={draft}
        selection={{ kind: 'field', id: 'party' }}
        onPatch={(patch: Record<string, unknown>) => {
          onPatch(patch);
          setDraft((d) => ({ ...d, ...patch }));
        }}
        onClearSelection={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
        locale={opts.locale ?? 'en-US'}
      />
    );
  }
  render(<Host />);
  /** The `party` definition the host's Save would persist after the last edit. */
  const saved = () => (onPatch.mock.calls.at(-1)![0].fields as Record<string, Def>).party;
  return { onPatch, saved };
}

const toggle = () => screen.queryByRole('checkbox', { name: LABEL });
const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** `FieldSchema`'s rejections of a saved definition, as `code@[path]`. */
const rejections = (def: Def): string[] => {
  const r = FieldSchema.safeParse({ name: 'party', ...def });
  return r.success ? [] : r.error.issues.map((i) => `${i.code}@[${i.path.join('.')}]`);
};

const LOOKUP: Def = { type: 'lookup', label: 'Vendor', reference: 'vendor' };
const USER: Def = { type: 'user', label: 'Buyer' };

async function retypeTo(typeLabel: string) {
  await userEvent.click(screen.getByRole('combobox', { name: t('designer.field.type', 'en-US') }));
  const list = await screen.findByRole('listbox', { name: t('designer.field.type', 'en-US') });
  await userEvent.click(within(list).getByRole('option', { name: typeLabel }));
}

describe('referenceNameVisible in the field inspector', () => {
  it.each([
    ['lookup', LOOKUP],
    ['user', USER],
  ] as const)('a %s field offers the toggle, and checking it saves referenceNameVisible: true', async (_type, def) => {
    const { saved } = renderField(def);
    const box = toggle();
    expect(box).not.toBeNull();
    expect((box as HTMLInputElement).checked).toBe(false);

    await userEvent.click(box!);

    expect(saved().referenceNameVisible).toBe(true);
    expect(rejections(saved())).toEqual([]);
    expect((toggle() as HTMLInputElement).checked).toBe(true);
  });

  it('the help text is the toggle\'s accessible description', () => {
    renderField(LOOKUP);
    expect(screen.getByRole('checkbox', { name: LABEL, description: HELP })).toBeTruthy();
  });

  it('clearing the toggle removes the key: the saved field carries no referenceNameVisible', async () => {
    const { saved } = renderField({ ...LOOKUP, referenceNameVisible: true });
    expect((toggle() as HTMLInputElement).checked).toBe(true);

    await userEvent.click(toggle()!);

    expect(has(saved(), 'referenceNameVisible')).toBe(false);
    expect(rejections(saved())).toEqual([]);
    expect((toggle() as HTMLInputElement).checked).toBe(false);
  });

  it('a stored false reads unchecked, and checking it writes true', async () => {
    const { saved } = renderField({ ...LOOKUP, referenceNameVisible: false });
    expect((toggle() as HTMLInputElement).checked).toBe(false);

    await userEvent.click(toggle()!);

    expect(saved().referenceNameVisible).toBe(true);
  });

  it.each([
    ['text', { type: 'text', label: 'Vendor name' }],
    ['master_detail', { type: 'master_detail', label: 'Vendor', reference: 'vendor' }],
  ] as const)('CONTROL — a %s field offers no toggle (the spec refuses the key there)', (_type, def) => {
    renderField(def);
    expect(toggle()).toBeNull();
    expect(screen.queryByTestId('field-reference-name-visible')).toBeNull();
  });

  it('CONTROL — a user field offers none of the lookup picker controls (its target is always sys_user)', () => {
    renderField(USER);
    expect(toggle()).not.toBeNull();
    expect(screen.queryByText(t('designer.field.relatedObject', 'en-US'))).toBeNull();
    expect(screen.queryByText(t('designer.field.lookup.pickerConfig', 'en-US'))).toBeNull();
    expect(screen.queryByText(t('designer.field.lookup.displayField', 'en-US'))).toBeNull();
    expect(screen.queryByText(t('designer.field.lookup.selectableRecords', 'en-US'))).toBeNull();
    expect(screen.queryByText(t('designer.field.lookup.dependsOn', 'en-US'))).toBeNull();
    expect(screen.queryByTestId('field-related-list')).toBeNull();
  });

  it('a retype away from lookup removes the key, so the save is not refused at [referenceNameVisible]', async () => {
    const { saved } = renderField({ ...LOOKUP, referenceNameVisible: true });

    await retypeTo('Text');

    expect(saved().type).toBe('text');
    expect(has(saved(), 'referenceNameVisible')).toBe(false);
    expect(rejections(saved()).filter((r) => r.endsWith('[referenceNameVisible]'))).toEqual([]);
    expect(toggle()).toBeNull();
  });

  it('a retype from lookup to user keeps the key (both types accept it)', async () => {
    const { saved } = renderField({ ...LOOKUP, referenceNameVisible: true });

    await retypeTo('User');

    expect(saved().type).toBe('user');
    expect(saved().referenceNameVisible).toBe(true);
    expect((toggle() as HTMLInputElement).checked).toBe(true);
  });

  it('zh: the toggle is labelled from the studio catalogue', () => {
    renderField(LOOKUP, { locale: 'zh-CN' });
    expect(screen.getByRole('checkbox', { name: '不可读时显示名称' })).toBeTruthy();
  });
});
