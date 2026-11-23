// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12326 — choosing `controlled_by_parent` in the Settings tab leaves
 * the object savable.
 *
 * Since `@objectstack/spec` 18 (objectstack#23100, ADR-0055 §1) a
 * `controlled_by_parent` object derives its master from exactly one
 * `master_detail` field declared `required: true`. Since ADR-0055 §1 as
 * amended (objectstack#30905 ruling A) the spec also reads an object's only
 * `master_detail` that is not required as an OPTIONAL master, whose rows may
 * name none. The designer forces the value: the pick writes `required: true`
 * on the master in the same patch, so every row names its master. With two or
 * more `master_detail` fields it picks none for the author, and shows the
 * spec's own refusal, which names the fix.
 *
 * The installed spec's `ObjectSchema` is the oracle: the object the patch
 * leaves behind is parsed as the save door parses it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CONTROLLED_BY_PARENT_MASTER_INVALID, ObjectSchema } from '@objectstack/spec/data';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { t, tFormat } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

afterEach(cleanup);

// Resident before any case, so a zh render reads the zh catalogue synchronously.
const ZH = await loadStudioCatalogue('zh');

const CBP_LABEL = t('engine.studio.settings.sharingControlledByParent', 'en-US');
const PRIVATE_LABEL = t('engine.studio.settings.sharingPrivate', 'en-US');

function renderPanel(draft: Record<string, unknown>) {
  const onPatch = vi.fn();
  render(<ObjectSettingsPanel name="crm_case" draft={draft} onPatch={onPatch} locale="en-US" />);
  return { onPatch };
}

async function pickSharing(label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId('owd-internal-select'), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
}

const ONE_MASTER = {
  subject: { type: 'text', label: 'Subject' },
  account: { type: 'master_detail', label: 'Account', reference: 'crm_account' },
};

const TWO_MASTERS = {
  account: { type: 'master_detail', reference: 'crm_account' },
  contact: { type: 'master_detail', reference: 'crm_contact' },
};

describe('ObjectSettingsPanel — controlled_by_parent forces the master required (objectui#12326)', () => {
  it('choosing it with one non-required master writes required: true, and the object parses', async () => {
    const draft = { name: 'crm_case', sharingModel: 'private', fields: ONE_MASTER };
    // The control leg: as the draft stands, switching only the model leaves an
    // optional master — it parses, as `required: false`.
    const control = ObjectSchema.safeParse({ ...draft, sharingModel: 'controlled_by_parent' });
    expect(control.success).toBe(true);
    expect((control.data?.fields as Record<string, { required?: boolean }>).account.required).toBe(false);

    const { onPatch } = renderPanel(draft);
    await pickSharing(CBP_LABEL);

    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toEqual({
      sharingModel: 'controlled_by_parent',
      fields: {
        subject: { type: 'text', label: 'Subject' },
        account: { type: 'master_detail', label: 'Account', reference: 'crm_account', required: true },
      },
    });
    const parsed = ObjectSchema.safeParse({ ...draft, ...patch });
    expect(parsed.success).toBe(true);
    expect((parsed.data?.fields as Record<string, { required?: boolean }>).account.required).toBe(true);
  });

  it('writes only the model when the master is already required', async () => {
    const fields = { account: { type: 'master_detail', reference: 'crm_account', required: true } };
    const { onPatch } = renderPanel({ name: 'crm_case', sharingModel: 'private', fields });
    await pickSharing(CBP_LABEL);
    expect(onPatch.mock.calls[0][0]).toEqual({ sharingModel: 'controlled_by_parent' });
  });

  it('another model leaves the fields alone', async () => {
    const { onPatch } = renderPanel({ name: 'crm_case', sharingModel: 'public_read', fields: ONE_MASTER });
    await pickSharing(PRIVATE_LABEL);
    expect(onPatch.mock.calls[0][0]).toEqual({ sharingModel: 'private' });
  });

  it('with two master-detail fields it picks neither, and shows the refusal in business words', async () => {
    const draft = { name: 'crm_case', sharingModel: 'private', fields: TWO_MASTERS };
    const { onPatch } = renderPanel(draft);
    await pickSharing(CBP_LABEL);
    const patch = onPatch.mock.calls[0][0] as { fields: Record<string, Record<string, unknown>> };
    expect(patch.fields.account.required).toBe(true);
    expect(patch.fields.contact.required).toBe(true);

    // The panel the patch leads to shows the save door's verdict, worded by
    // the shape the spec stamps on its issue (objectstack#36526).
    cleanup();
    const next = { ...draft, ...patch };
    const parsed = ObjectSchema.safeParse(next);
    expect(parsed.success).toBe(false);
    const issue = parsed.success ? undefined : parsed.error.issues.find((i) => i.path.join('.') === 'fields');
    expect((issue as { params?: unknown } | undefined)?.params).toEqual({
      code: CONTROLLED_BY_PARENT_MASTER_INVALID,
      shape: 'several-required-masters',
    });
    renderPanel(next);
    expect(screen.getByTestId('owd-cbp-refusal').textContent).toBe(
      tFormat('engine.studio.settings.cbpRefusalSeveralRequiredMasters', 'en-US', { fields: '“account”, “contact”' }),
    );
  });

  it('shows no refusal for an object that derives exactly one master, nor for another model', () => {
    renderPanel({
      name: 'crm_case',
      sharingModel: 'controlled_by_parent',
      fields: { account: { type: 'master_detail', reference: 'crm_account', required: true } },
    });
    expect(screen.queryByTestId('owd-cbp-refusal')).toBeNull();
    cleanup();
    renderPanel({ name: 'crm_case', sharingModel: 'private', fields: TWO_MASTERS });
    expect(screen.queryByTestId('owd-cbp-refusal')).toBeNull();
  });

  it('shows the refusal for a controlled_by_parent object with no master-detail field', () => {
    const draft = { name: 'crm_case', sharingModel: 'controlled_by_parent', fields: { subject: { type: 'text' } } };
    const parsed = ObjectSchema.safeParse(draft);
    expect(parsed.success).toBe(false);
    renderPanel(draft);
    expect(screen.getByTestId('owd-cbp-refusal').textContent).toBe(t('engine.studio.settings.cbpRefusalNoMaster', 'en-US'));
  });
});

describe('ObjectSettingsPanel — the controlled_by_parent refusal speaks the author\'s language (objectstack#36526)', () => {
  function renderIn(draft: Record<string, unknown>, locale: 'en-US' | 'zh-CN') {
    render(<ObjectSettingsPanel name="crm_case" draft={draft} onPatch={vi.fn()} locale={locale} />);
    return screen.getByTestId('owd-cbp-refusal').textContent ?? '';
  }

  const CASES: Array<[string, Record<string, unknown>, string, Record<string, string>, Record<string, string>]> = [
    [
      'two required masters',
      {
        account: { type: 'master_detail', label: 'Account', reference: 'crm_account', required: true },
        contact: { type: 'master_detail', reference: 'crm_contact', required: true },
      },
      'engine.studio.settings.cbpRefusalSeveralRequiredMasters',
      { fields: '“Account”, “contact”' },
      { fields: '「Account」、「contact」' },
    ],
    [
      'two master-detail fields, none required',
      {
        account: { type: 'master_detail', reference: 'crm_account', required: false },
        contact: { type: 'master_detail', reference: 'crm_contact', required: false },
      },
      'engine.studio.settings.cbpRefusalSeveralMasters',
      { fields: '“account”, “contact”' },
      { fields: '「account」、「contact」' },
    ],
    [
      'a required lookup only',
      { account: { type: 'lookup', label: 'Account', reference: 'crm_account', required: true } },
      'engine.studio.settings.cbpRefusalRequiredLookupOnly',
      { fields: '“Account”' },
      { fields: '「Account」' },
    ],
    ['no relationship field', { subject: { type: 'text' } }, 'engine.studio.settings.cbpRefusalNoMaster', {}, {}],
    [
      'a required master marked readonly',
      { account: { type: 'master_detail', label: 'Account', reference: 'crm_account', required: true, readonly: true } },
      'engine.studio.settings.cbpRefusalMasterNotWritable',
      { field: '“Account”' },
      { field: '「Account」' },
    ],
    [
      'two required lookups only',
      {
        account: { type: 'lookup', label: 'Account', reference: 'crm_account', required: true },
        contact: { type: 'lookup', reference: 'crm_contact', required: true },
      },
      'engine.studio.settings.cbpRefusalRequiredLookupsOnly',
      { fields: '“Account”, “contact”' },
      { fields: '「Account」、「contact」' },
    ],
    [
      'a master that writes no required, marked readonly (the parse reads it as the optional master)',
      { account: { type: 'master_detail', label: 'Account', reference: 'crm_account', readonly: true } },
      'engine.studio.settings.cbpRefusalMasterNotWritable',
      { field: '“Account”' },
      { field: '「Account」' },
    ],
    [
      'a required master marked system',
      { account: { type: 'master_detail', reference: 'crm_account', required: true, system: true } },
      'engine.studio.settings.cbpRefusalMasterNotWritable',
      { field: '“account”' },
      { field: '「account」' },
    ],
  ];

  it.each(CASES)('%s: the wording its shape selects, in en and zh, naming the fields', (_label, fields, key, enVars, zhVars) => {
    const draft = { name: 'crm_case', sharingModel: 'controlled_by_parent', fields };
    const en = renderIn(draft, 'en-US');
    expect(en).toBe(tFormat(key, 'en-US', enVars));
    cleanup();
    const zh = renderIn(draft, 'zh-CN');
    expect(zh).toBe(tFormat(key, 'zh-CN', zhVars));
    // The zh row is the zh catalogue's, not the English fallback.
    expect(ZH[key]).toBeTruthy();
    expect(zh).not.toBe(en);
    // Neither carries the spec's developer text: no ADR number, no spec version, no raw key syntax.
    for (const text of [en, zh]) {
      expect(text).not.toMatch(/ADR-|@objectstack\/spec|sharingModel|master_detail|required: /);
    }
  });
});
