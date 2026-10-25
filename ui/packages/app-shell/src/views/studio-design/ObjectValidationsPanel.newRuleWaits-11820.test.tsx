/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11820 — a new validation rule is not saved as a no-op.
 *
 * Choosing a type in the New menu used to write `validation_1` to the object
 * draft at once, with the guard `'false'` (a rule that can never fire) and no
 * "Runs on" box checked, and the Data pillar's autosave stored it. Now:
 *
 *   - a guarded type (`script`, `cross_field`, `conditional`) stays out of the
 *     draft, listed and open, marked not saved, with the hold's line and input
 *     hint (objectui#11786's wording), until the author gives it a condition —
 *     for a `conditional`, its `then` rule's condition too;
 *   - every new rule starts on Create + Update;
 *   - the rule the panel finally writes parses through the spec's own
 *     `ObjectSchema`, the parse the draft save applies.
 *
 * Controls: an existing rule is edited exactly as before (a type switch still
 * seeds the valid `'false'` placeholder, since that rule is already in the
 * draft), and a type with no guard is written at once.
 *
 * The harness feeds every `onPatch` back into `draft`, as the Data pillar does,
 * so what the panel shows after a write is what the pillar would show.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';

afterEach(() => cleanup());

const baseDraft: Record<string, unknown> = {
  name: 'invoice',
  label: 'Invoice',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
  validations: [
    { type: 'script', name: 'no_negative', message: 'no', condition: 'record.amount < 0', severity: 'error' },
  ],
};

const GUARD = 'has(record.amount) && record.amount > 100';

function Harness({ onPatch, initial = baseDraft }: { onPatch: (p: Record<string, unknown>) => void; initial?: Record<string, unknown> }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <ObjectValidationsPanel
      draft={draft}
      onPatch={(p) => {
        onPatch(p);
        setDraft((d) => ({ ...d, ...p }));
      }}
    />
  );
}

function addFromMenu(label: string) {
  fireEvent.click(screen.getByText('New'));
  // The per-type list sits under Advanced since objectui#11861.
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
}

/** Switch the open rule's guard editor to raw CEL and type `cel` into it. */
function typeGuard(cel: string) {
  fireEvent.click(screen.getByRole('button', { name: /Expression/ }));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: cel } });
}

/** Pick `label` in the open rule's Type picker, the shared `Select` (objectui#11865). */
async function pickType(label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId('rule-type'), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

function lastValidations(onPatch: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const calls = onPatch.mock.calls;
  return calls[calls.length - 1][0].validations as Array<Record<string, unknown>>;
}

describe('a new validation rule waits for its condition (objectui#11820)', () => {
  it('a new Script rule is listed and open, but not written, and says what it needs', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Script — CEL fail condition');

    expect(onPatch).not.toHaveBeenCalled();
    // Listed, marked, and open in the editor.
    expect(screen.getByText('validation_2')).toBeInTheDocument();
    expect(screen.getByTestId('rule-unsaved')).toHaveTextContent('Not saved — needs a condition');
    expect(screen.getByDisplayValue('validation_2')).toBeInTheDocument();
    // The hold's own sentence, naming the rule, and its hint under the guard.
    expect(screen.getByTestId('rule-held')).toHaveTextContent(
      'Not saved yet: the rule “validation_2” needs a condition. Your changes are kept here and saved once it is filled in.',
    );
    expect(screen.getByTestId('rule-held-hint')).toHaveTextContent('Required. Changes are saved once this has a value.');
  });

  it('starts on Create + Update', () => {
    render(<Harness onPatch={vi.fn()} />);
    addFromMenu('Script — CEL fail condition');
    expect(screen.getByRole('checkbox', { name: 'Create' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Update' })).toBeChecked();
    // objectui#11923 — the row offers only the spec's events: no Delete box.
    expect(screen.queryByRole('checkbox', { name: 'Delete' })).toBeNull();
  });

  it('edits before the condition stay unsent and ride along when it is written', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Script — CEL fail condition');
    fireEvent.change(screen.getByPlaceholderText('e.g. Completion date is required when status is Done'), {
      target: { value: 'Too big' },
    });
    expect(onPatch).not.toHaveBeenCalled();

    typeGuard(GUARD);
    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = lastValidations(onPatch);
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual((baseDraft.validations as unknown[])[0]);
    expect(written[1]).toMatchObject({
      type: 'script',
      name: 'validation_2',
      message: 'Too big',
      condition: GUARD,
      events: ['insert', 'update'],
    });
    // Never the never-firing placeholder.
    expect(JSON.stringify(written)).not.toContain('"false"');
    // The draft the pillar would save parses.
    const parsed = ObjectSchema.safeParse({ ...baseDraft, validations: written });
    expect(parsed.success).toBe(true);

    // Written, it is an ordinary rule: no mark, no held line, still open.
    expect(screen.queryByTestId('rule-unsaved')).toBeNull();
    expect(screen.queryByTestId('rule-held')).toBeNull();
    expect(screen.getByDisplayValue('validation_2')).toBeInTheDocument();
  });

  it('a Conditional rule waits for its Then rule’s condition too, and says so', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Conditional — apply a rule when a guard holds');
    typeGuard(GUARD);
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('rule-held')).toHaveTextContent('the “Then” rule of “validation_2” needs a condition');

    const then = screen.getByLabelText('Then — rule applied when the condition holds (JSON)') as HTMLTextAreaElement;
    const seeded = JSON.parse(then.value) as Record<string, unknown>;
    // The seeded Then rule shows where its condition goes, and holds no placeholder.
    expect(seeded).toMatchObject({ type: 'script', condition: '' });
    fireEvent.change(then, { target: { value: JSON.stringify({ ...seeded, condition: 'record.amount > 1000' }) } });
    fireEvent.blur(then);

    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = lastValidations(onPatch)[1];
    expect(written).toMatchObject({ type: 'conditional', when: GUARD, then: { condition: 'record.amount > 1000' } });
    expect(ObjectSchema.safeParse({ ...baseDraft, validations: [written] }).success).toBe(true);
  });

  it('deleting a rule that was never written writes nothing', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Cross-field — CEL over multiple fields');
    fireEvent.click(screen.getByTestId('rule-delete'));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.queryByText('validation_2')).toBeNull();
  });

  it('control — a type with no guard is written at once, on Create + Update', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Format — regex / built-in format');
    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = lastValidations(onPatch)[1];
    expect(written).toMatchObject({ type: 'format', name: 'validation_2', events: ['insert', 'update'] });
    expect(ObjectSchema.safeParse({ ...baseDraft, validations: [written] }).success).toBe(true);
    expect(screen.queryByTestId('rule-unsaved')).toBeNull();
  });

  it('control — an existing rule switched to a guarded type is still written at once with the valid placeholder', async () => {
    const onPatch = vi.fn();
    const initial = {
      ...baseDraft,
      validations: [{ type: 'format', name: 'code_format', message: 'bad', field: 'name', regex: '^[A-Z]+$' }],
    };
    render(<Harness onPatch={onPatch} initial={initial} />);
    expect(screen.getByTestId('rule-type')).toHaveTextContent('Format — regex / built-in format');
    await pickType('Script — CEL fail condition');
    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = lastValidations(onPatch)[0];
    expect(written).toMatchObject({ type: 'script', name: 'code_format', message: 'bad', condition: 'false' });
    // No events were authored on it, and the switch adds none.
    expect(written).not.toHaveProperty('events');
    expect(screen.queryByTestId('rule-unsaved')).toBeNull();
  });

  it('control — the existing rule list and its editor are unchanged by an unsaved rule', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Script — CEL fail condition');
    fireEvent.click(screen.getByText('no_negative'));
    fireEvent.change(screen.getByDisplayValue('no'), { target: { value: 'never negative' } });
    expect(onPatch).toHaveBeenCalledTimes(1);
    // Only the existing rule is written; the unsaved one stays out of the draft.
    expect(lastValidations(onPatch)).toEqual([
      { ...(baseDraft.validations as Array<Record<string, unknown>>)[0], message: 'never negative' },
    ]);
    expect(screen.getByText('validation_2')).toBeInTheDocument();
  });
});
