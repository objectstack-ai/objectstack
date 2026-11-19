/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35189 — `WizardForm`'s final-submit gate (`gateFinalSubmit`)
 * judges a `visibleWhen` that reads a `formula` field on the value the written
 * record would serve, as the form renderer does since objectstack#35033
 * (`planObjectFormulas`, ADR-0113's formula paragraph).
 *
 * The gate re-checks every declared field at the final submit, including the
 * ones on a step the user skipped and never mounted. It judged them on the
 * record as last read, so a formula's stale stored value decided whether a
 * required field was demanded: after an edit that moved the formula out of
 * the field's condition the gate demanded a field the server does not require,
 * and after an edit that moved it in the gate let the save go without a field
 * the server does require. The same gate serves a simple form's mobile stepper.
 *
 * Every case edits step 1, skips straight past the step holding the gated
 * field, and presses Update, so only the cross-step gate has an opinion. The
 * observable is whether `dataSource.update` was called. The CONTROL cases read
 * the same condition straight off a stored column, with no formula in between:
 * they pass before and after the fix.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { WizardForm } from '../WizardForm';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The ticket object: `escalated` is a formula over `status`. */
function ticketSchema(reasonVisibleWhen: string) {
  return {
    name: 'ticket',
    fields: {
      subject: { type: 'text', label: 'Subject' },
      status: { type: 'text', label: 'Status' },
      account: { type: 'lookup', label: 'Account', reference: 'account' },
      escalated: { type: 'formula', label: 'Escalated', expression: "record.status == 'escalated'" },
      // Unservable on the form: it reads through a reference.
      vip: { type: 'formula', label: 'VIP', expression: "record.account.tier == 'gold'" },
      escalation_reason: {
        type: 'text',
        label: 'Escalation Reason',
        required: true,
        visibleWhen: reasonVisibleWhen,
      },
      notes: { type: 'text', label: 'Notes' },
    },
  };
}

const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
  if (!input) throw new Error(`field not rendered: ${name}`);
  fireEvent.change(input, { target: { value } });
};

const stepIndicator = (index: number) =>
  document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="Progress"] button')[index];

function editWizard(reasonVisibleWhen: string, stored: Record<string, unknown>) {
  const dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(ticketSchema(reasonVisibleWhen)),
    findOne: vi.fn().mockResolvedValue({ id: 't1', subject: 'Outage', notes: '', escalation_reason: null, ...stored }),
    create: vi.fn(),
    update: vi.fn(async (_o: string, _id: string, d: any) => ({ id: 't1', ...stored, ...d })),
  };
  // Mounted as a host mounts it: the data source in the renderer context too,
  // so the step forms compute the same formulas the final gate does.
  render(
    <SchemaRendererProvider dataSource={dataSource as any}>
      <WizardForm
        schema={{
          type: 'object-form',
          formType: 'wizard',
          objectName: 'ticket',
          mode: 'edit',
          recordId: 't1',
          allowSkip: true,
          sections: [
            { name: 's1', label: 'Step 1', fields: ['subject', 'status'] },
            { name: 's2', label: 'Step 2', fields: ['escalation_reason'] },
            { name: 's3', label: 'Step 3', fields: ['notes'] },
          ],
        } as any}
        dataSource={dataSource as any}
      />
    </SchemaRendererProvider>,
  );
  return dataSource;
}

/** Edit step 1 as asked, jump past step 2 to step 3, and press Update. */
async function editAndSubmit(step1: Record<string, string>) {
  await waitFor(() => {
    const el = document.body.querySelector<HTMLInputElement>('[data-field="subject"] input');
    if (!el || el.value !== 'Outage') throw new Error('record not on screen yet');
  });
  for (const [name, value] of Object.entries(step1)) fill(name, value);
  fireEvent.click(stepIndicator(2));
  await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
  fill('notes', 'followed up');
  expect(document.body.querySelector('[data-field="escalation_reason"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Update/i }));
}

async function expectSaved(dataSource: { update: ReturnType<typeof vi.fn> }) {
  await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
}

/**
 * Refused: the gate marks the step holding the field, the wizard lands there
 * and draws the field, and nothing is sent.
 */
async function expectRefused(dataSource: { update: ReturnType<typeof vi.fn> }) {
  await waitFor(() =>
    expect(document.body.querySelector('[data-testid="wizard-step:s2"]')?.getAttribute('data-error')).toBe('true'),
  );
  await waitFor(() => expect(document.body.querySelector('[data-field="escalation_reason"]')).toBeTruthy());
  expect(dataSource.update).not.toHaveBeenCalled();
}

const BY_FORMULA = 'record.escalated == true';
const BY_COLUMN = "record.status == 'escalated'";

describe('WizardForm final gate — a visibleWhen reading a formula is judged on the computed value (objectstack#35189)', () => {
  it('an edit that moves the formula OUT of the condition saves without the hidden required field', async () => {
    const dataSource = editWizard(BY_FORMULA, { status: 'escalated', escalated: true });
    await editAndSubmit({ status: 'open' });
    await expectSaved(dataSource);
    expect(dataSource.update.mock.calls[0][2]).toMatchObject({ status: 'open', notes: 'followed up' });
  });

  it('an edit that moves the formula INTO the condition demands the required field', async () => {
    const dataSource = editWizard(BY_FORMULA, { status: 'open', escalated: false });
    await editAndSubmit({ status: 'escalated' });
    await expectRefused(dataSource);
  });

  it('a visibleWhen reading a formula the form cannot compute keeps the field shown and required, as the step form draws it', async () => {
    const dataSource = editWizard('record.vip == true', { status: 'open', vip: false, account: 'a1' });
    await editAndSubmit({ status: 'pending' });
    await expectRefused(dataSource);
  });
});

describe('#35189 CONTROLS — no formula in between: these pass before and after the fix', () => {
  it('a stored column moved out of the condition saves', async () => {
    const dataSource = editWizard(BY_COLUMN, { status: 'escalated', escalated: true });
    await editAndSubmit({ status: 'open' });
    await expectSaved(dataSource);
  });

  it('a stored column moved into the condition is refused', async () => {
    const dataSource = editWizard(BY_COLUMN, { status: 'open', escalated: false });
    await editAndSubmit({ status: 'escalated' });
    await expectRefused(dataSource);
  });
});
