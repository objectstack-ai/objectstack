// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12326 — choosing `controlled_by_parent` in the Settings tab leaves
 * the object savable.
 *
 * Since `@objectstack/spec` 18 (objectstack#23100, ADR-0055 §1) a
 * `controlled_by_parent` object derives its master from exactly one
 * `master_detail` field declared `required: true`, and the save door refuses
 * any other shape. The designer forces the value: the pick writes
 * `required: true` on the master in the same patch. With two or more
 * `master_detail` fields it picks none for the author, and shows the spec's own
 * refusal, which names the fix.
 *
 * The installed spec's `ObjectSchema` is the oracle: the object the patch
 * leaves behind is parsed as the save door parses it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
import { t } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

afterEach(cleanup);

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
    // The control leg: as the draft stands, switching only the model is refused.
    expect(ObjectSchema.safeParse({ ...draft, sharingModel: 'controlled_by_parent' }).success).toBe(false);

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
    expect(ObjectSchema.safeParse({ ...draft, ...patch }).success).toBe(true);
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

  it('with two master-detail fields it picks neither, and shows the spec\'s refusal', async () => {
    const draft = { name: 'crm_case', sharingModel: 'private', fields: TWO_MASTERS };
    const { onPatch } = renderPanel(draft);
    await pickSharing(CBP_LABEL);
    const patch = onPatch.mock.calls[0][0] as { fields: Record<string, Record<string, unknown>> };
    expect(patch.fields.account.required).toBe(true);
    expect(patch.fields.contact.required).toBe(true);

    // The panel the patch leads to shows what the save door will say, verbatim.
    cleanup();
    const next = { ...draft, ...patch };
    const parsed = ObjectSchema.safeParse(next);
    expect(parsed.success).toBe(false);
    const specText = parsed.success ? '' : parsed.error.issues.find((i) => i.path.join('.') === 'fields')?.message;
    expect(specText).toBeTruthy();
    renderPanel(next);
    expect(screen.getByTestId('owd-cbp-refusal')).toHaveTextContent(specText!);
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
    const specText = parsed.success ? '' : parsed.error.issues.find((i) => i.path.join('.') === 'sharingModel')?.message;
    expect(specText).toBeTruthy();
    renderPanel(draft);
    expect(screen.getByTestId('owd-cbp-refusal')).toHaveTextContent(specText!);
  });
});
