/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console's record create and edit dialog shows a refusal's producer-marked
 * `userMessage`, and the generic permission line only without one
 * (objectstack#33524).
 *
 * The dialog the console's New and Edit buttons open is this `ModalForm`; its
 * submit rethrows into the form renderer, whose refusal reader takes
 * `declaredUserMessage` before the fixed `form.noPermissionToSave` line. The
 * card measured the fixed line on a `controlled_by_parent` master-edit refusal:
 * that refusal reaches the console with no `userMessage` at all, so the line is
 * the reader's answer to what the server sent. These pins hold the console half
 * — a marked 403 shows its sentence on create and on edit, in en and zh-CN —
 * so the producer composing one is all the master-edit case needs.
 *
 * Driven as a user does: the dialog renders, the user types and presses the
 * dialog's own submit button, the data source refuses, and the assertion reads
 * the dialog's text.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm, type ModalFormProps, type ModalFormSchema } from './ModalForm';

registerAllFields();

const GENERIC = "You don't have permission to save this record.";
/** The developer sentence plugin-security puts on a master-edit refusal's `message`. */
const DIAGNOSTIC =
  "[Security] Access denied: insert on 'crm_billing_milestone' requires edit access to its master record (no edit access)";
const MARKED_EN = 'You need edit access to the contract this milestone belongs to.';
const MARKED_ZH = '你需要对该里程碑所属合同的编辑权限。';

/** A 403 as the ObjectStack adapter throws it: status, code, and the lifted marking when sent. */
function refusal(userMessage?: string): Error {
  return Object.assign(new Error(DIAGNOSTIC), {
    status: 403,
    code: 'PERMISSION_DENIED',
    ...(userMessage !== undefined ? { userMessage } : {}),
  });
}

function makeDS(err: Error) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'crm_billing_milestone',
      fields: { name: { type: 'text', label: 'Name' } },
    }),
    findOne: vi.fn().mockResolvedValue({ id: 'm1', name: 'Kick-off' }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async () => {
      throw err;
    }),
    update: vi.fn(async () => {
      throw err;
    }),
  };
}

async function submitRefused(mode: 'create' | 'edit', err: Error): Promise<ReturnType<typeof makeDS>> {
  const ds = makeDS(err);
  const schema: ModalFormSchema = {
    type: 'object-form',
    formType: 'modal',
    objectName: 'crm_billing_milestone',
    mode,
    recordId: mode === 'edit' ? 'm1' : undefined,
    title: mode === 'edit' ? 'Edit Milestone' : 'New Milestone',
    open: true,
  };
  render(<ModalForm schema={schema} dataSource={ds as unknown as ModalFormProps['dataSource']} />);
  const box = await waitFor(() => {
    const el = document.body.querySelector('input[name="name"]') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    if (mode === 'edit') expect(el!.value).toBe('Kick-off');
    return el!;
  });
  fireEvent.change(box, { target: { value: 'Milestone 2' } });
  fireEvent.click(screen.getByRole('button', { name: mode === 'edit' ? 'Update' : 'Create' }));
  await waitFor(() => expect(mode === 'edit' ? ds.update : ds.create).toHaveBeenCalledTimes(1));
  return ds;
}

describe('ModalForm — a refused save shows the producer-marked reason (objectstack#33524)', () => {
  for (const mode of ['create', 'edit'] as const) {
    for (const [lang, marked] of [['en', MARKED_EN], ['zh-CN', MARKED_ZH]] as const) {
      it(`${mode}: a 403 carrying a ${lang} userMessage shows that sentence, not the generic line`, async () => {
        await submitRefused(mode, refusal(marked));

        expect(await screen.findByText(marked)).toBeInTheDocument();
        expect(screen.queryByText(GENERIC)).toBeNull();
        expect(document.body.textContent).not.toContain(DIAGNOSTIC);
      });
    }

    it(`${mode}: CONTROL — a 403 with no userMessage keeps the generic line and withholds the diagnostic`, async () => {
      await submitRefused(mode, refusal());

      expect(await screen.findByText(GENERIC)).toBeInTheDocument();
      expect(document.body.textContent).not.toContain(DIAGNOSTIC);
    });
  }
});
