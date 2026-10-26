/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8069 — the WIZARD's cross-step gate refuses the final submit when a
 * field's `visibleWhen` could not be evaluated, naming the field and the rule
 * (ADR-0137 D2, ruled as Q1 = B: one judge per rule).
 *
 * The field under test sits on the MIDDLE step and the user jumps past it
 * (`allowSkip`), so its step form never mounts and the renderer's own submit
 * refusal never runs for it: only the cross-step gate can see the fault, which
 * is exactly why the ruling names the gate. The observable is the one the
 * sibling pin `wizardPredicateScope.test.tsx` uses — whether
 * `dataSource.create` was called — plus the step the wizard lands on and the
 * message it raises.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { toast } from '@object-ui/components';
import { WizardForm } from './WizardForm';

registerAllFields();

let toastError: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id' as never);
  // Muted: the faults these cases provoke warn once each by design.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const makeDataSource = (ownerRules: Record<string, unknown>) => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'case',
    fields: {
      subject: { type: 'text', label: 'Subject' },
      owner: { type: 'text', label: 'Owner', ...ownerRules },
      notes: { type: 'text', label: 'Notes' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: 'case-1' }),
  update: vi.fn(),
  findOne: vi.fn(),
});

const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
  if (!input) throw new Error(`field not rendered: ${name}`);
  fireEvent.change(input, { target: { value } });
};

const stepIndicator = (index: number) =>
  document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="Progress"] button')[index];

/** 3-step create wizard; skip step 2 (`owner`), fill step 3, press Create. */
async function skipPastOwnerAndSubmit(
  ownerRules: Record<string, unknown>,
  ownerField: string | Record<string, unknown> = 'owner',
) {
  const dataSource = makeDataSource(ownerRules);
  render(
    <WizardForm
      schema={{
        type: 'object-form',
        formType: 'wizard',
        objectName: 'case',
        mode: 'create',
        allowSkip: true,
        sections: [
          { name: 's1', label: 'Step 1', fields: ['subject'] },
          { name: 's2', label: 'Step 2', fields: [ownerField] },
          { name: 's3', label: 'Step 3', fields: ['notes'] },
        ],
      } as never}
      dataSource={dataSource as never}
    />,
  );
  await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
  fill('subject', 'S1');
  fireEvent.click(stepIndicator(2));
  await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
  fill('notes', 'S3');
  expect(document.body.querySelector('[data-field="owner"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Create/i }));
  return dataSource;
}

async function expectSubmitted(dataSource: ReturnType<typeof makeDataSource>) {
  await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
}

describe('objectui#8069 — the wizard gate refuses a faulted visibleWhen', () => {
  it('refuses the final submit, lands on the step holding the field, and names field and rule', async () => {
    const ds = await skipPastOwnerAndSubmit({ visibleWhen: "'x' in no_such_root_8069.tags" });
    await waitFor(() => expect(document.body.querySelector('[data-field="owner"]')).toBeTruthy());
    expect(ds.create).not.toHaveBeenCalled();
    const messages: string[] = toastError.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(messages.some((m) => /visibleWhen rule of Owner could not be evaluated/.test(m))).toBe(true);
  });

  it('CONTROL — the same field with a rule that evaluates lets the submit through', async () => {
    const ds = await skipPastOwnerAndSubmit({ visibleWhen: "record.subject == 'S1'" });
    await expectSubmitted(ds);
  });

  it('a STORED blank visibleWhen is refused by the gate too — ADR-0137 D2', async () => {
    const ds = await skipPastOwnerAndSubmit({ visibleWhen: '   ' });
    await waitFor(() => expect(document.body.querySelector('[data-field="owner"]')).toBeTruthy());
    expect(ds.create).not.toHaveBeenCalled();
    const messages: string[] = toastError.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(messages.some((m) => /visibleWhen rule of Owner could not be evaluated/.test(m))).toBe(true);
  });

  it('control — a blank VIEW-level visibleWhen is a layout gate, not a field rule: the submit goes through, and the blank is said', async () => {
    // `sectionFields` drops a blank view-level predicate before it reaches the
    // runtime field (`attachVisibility`), so the gate never sees it at all —
    // "no gate", and nothing on this path refuses it. Since objectui#11262 the
    // drop is not silent (ADR-0137 D4): `attachVisibility` reports the blank it
    // drops through the `[blank]` channel, naming the field.
    const ds = await skipPastOwnerAndSubmit({}, { field: 'owner', visibleWhen: '' });
    await expectSubmitted(ds);
    const lines = warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((w: string) => w.includes('[blank]'));
    expect(lines.some((w: string) => w.includes("'owner'"))).toBe(true);
  });

  it('a faulted requiredWhen is NOT refused by the gate — the server refuses it (D2)', async () => {
    const ds = await skipPastOwnerAndSubmit({ requiredWhen: "'x' in no_such_root_8069.tags" });
    await expectSubmitted(ds);
  });

  it('ACCEPTED RESIDUAL — a visibleWhen reading previous is refused on a CREATE wizard', async () => {
    const ds = await skipPastOwnerAndSubmit({ visibleWhen: "previous.status == 'open'" });
    await waitFor(() => expect(document.body.querySelector('[data-field="owner"]')).toBeTruthy());
    expect(ds.create).not.toHaveBeenCalled();
  });
});
