/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#28106 — AI-proposed changes on an EDIT wizard.
 *
 * The wizard reuses one inner `form` across its steps and draws only the
 * current step's fields. A proposal is therefore tried per field, on the first
 * reset where the form draws that field, and never again:
 *   1. a step-2 field's proposal is applied and marked when step 2 is drawn
 *      (one "applied once" flag for the whole form dropped it silently);
 *   2. CONTROL: a step-1 field the person reverted is not re-applied when they
 *      go Next and come Back.
 *
 * Direction, written before the run: with one flag for the whole form, cell 1
 * RED (step 2 opens on the stored phone); with attempts not recorded per field,
 * cell 2 RED (Back re-applies the proposed name).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { SuggestedFieldChangesContext } from '@object-ui/components';
import { registerAllFields } from '@object-ui/fields';
import { WizardForm } from './WizardForm';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STORED = { id: 'r1', name: '张伟', phone: '13900001111' };

const objectSchema = {
  name: 'wiz_obj',
  fields: {
    name: { type: 'text', label: 'Name' },
    phone: { type: 'text', label: 'Phone' },
  },
};

const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(),
  update: vi.fn(async (_o: string, _id: string, data: any) => ({ ...STORED, ...data })),
  findOne: vi.fn().mockResolvedValue(STORED),
});

const schema = {
  type: 'object-form',
  formType: 'wizard',
  objectName: 'wiz_obj',
  mode: 'edit',
  recordId: 'r1',
  sections: [
    { label: 'Step 1', fields: ['name'] },
    { label: 'Step 2', fields: ['phone'] },
  ],
};

const PROPOSED = new Map<string, unknown>([
  ['name', '李四'],
  ['phone', '13800000000'],
]);

/** The step's input once the step form's pending `defaultValues` reset has run. */
const settledInput = async (container: HTMLElement, name: string, value: string) => {
  const el = await waitFor(() => {
    const found = container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!found) throw new Error(`step input "${name}" not rendered`);
    expect(found).toHaveValue(value);
    return found;
  });
  await act(async () => {});
  return el;
};

const marks = (c: HTMLElement) => c.querySelectorAll('[data-ai-suggested="true"]');
const befores = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-ai-before="true"]')).map((e) => e.textContent);
const reverts = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-ai-revert="true"]')) as HTMLElement[];

describe('WizardForm — AI-proposed changes on an edit wizard (objectstack#28106)', () => {
  it('applies a later step\'s proposal on that step; a reverted earlier one is not re-applied on Next/Back', async () => {
    const ds = makeDS();
    const { container } = render(
      <SuggestedFieldChangesContext.Provider value={PROPOSED}>
        <WizardForm schema={schema as any} dataSource={ds as any} />
      </SuggestedFieldChangesContext.Provider>,
    );

    // Step 1: the name proposal is applied and marked; revert it.
    await settledInput(container, 'name', '李四');
    expect(marks(container)).toHaveLength(1);
    expect(befores(container)).toEqual(['Was: 张伟']);
    fireEvent.click(reverts(container)[0]);
    await settledInput(container, 'name', '张伟');
    expect(marks(container)).toHaveLength(0);

    // Next → step 2: the phone proposal is applied and marked there (cell 1).
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await settledInput(container, 'phone', '13800000000');
    expect(marks(container)).toHaveLength(1);
    expect(befores(container)).toEqual(['Was: 13900001111']);
    expect(reverts(container)).toHaveLength(1);

    // Back → step 1: the reverted name stays reverted (cell 2, CONTROL).
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await settledInput(container, 'name', '张伟');
    expect(marks(container)).toHaveLength(0);
    expect(reverts(container)).toHaveLength(0);

    // …and Next again: still not re-applied, and step 2 keeps its proposal.
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await settledInput(container, 'phone', '13800000000');
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await settledInput(container, 'name', '张伟');
    expect(marks(container)).toHaveLength(0);
  });
});
