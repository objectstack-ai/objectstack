/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27521 (Studio row 26) — a new rule's name is read off its
 * message, and an authored rule's name never moves.
 *
 * A new rule opened as `validation_1` under "Rule name (snake_case, unique)",
 * so the author either kept a name that says nothing or had to type a machine
 * identifier. The name the panel mints now follows the message until the
 * author edits the name; the rule written parses through the spec's own
 * `ObjectSchema`, the parse the draft save applies.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';

afterEach(() => cleanup());

const baseDraft: Record<string, unknown> = {
  name: 'invoice',
  label: 'Invoice',
  fields: {
    name: { type: 'text', label: 'Name' },
    hours: { type: 'number', label: 'Hours' },
  },
  validations: [
    { type: 'script', name: 'no_negative', message: 'Hours can’t be negative', condition: 'record.hours < 0', severity: 'error' },
  ],
};

function Harness({ onPatch }: { onPatch: (p: Record<string, unknown>) => void }) {
  const [draft, setDraft] = React.useState(baseDraft);
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
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
}

const nameBox = () => screen.getByRole('textbox', { name: /API name/ }) as HTMLInputElement;
const messageBox = () => screen.getByRole('textbox', { name: /Error message/ }) as HTMLInputElement;

function typeGuard(cel: string) {
  fireEvent.click(screen.getByRole('button', { name: /Expression/ }));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: cel } });
}

function lastValidations(onPatch: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const calls = onPatch.mock.calls;
  return calls[calls.length - 1][0].validations as Array<Record<string, unknown>>;
}

describe('a new rule is named from its message (objectstack#27521)', () => {
  it('the minted name follows the message, and the written rule parses', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Condition — reject the save when it is true');
    expect(nameBox().value).toBe('validation_2');

    fireEvent.change(messageBox(), { target: { value: 'Hours over 40' } });
    expect(nameBox().value).toBe('hours_over_40');
    typeGuard('record.hours > 40');

    const written = lastValidations(onPatch).find((r) => r.name === 'hours_over_40');
    expect(written).toMatchObject({ message: 'Hours over 40', condition: 'record.hours > 40' });
    expect(ObjectSchema.safeParse({ ...baseDraft, validations: lastValidations(onPatch) }).success).toBe(true);
  });

  it('a name the author typed stops following the message', () => {
    render(<Harness onPatch={vi.fn()} />);
    addFromMenu('Condition — reject the save when it is true');
    fireEvent.change(nameBox(), { target: { value: 'my_rule' } });
    fireEvent.change(messageBox(), { target: { value: 'Hours over 40' } });
    expect(nameBox().value).toBe('my_rule');
  });

  it('a derived name another rule holds gets a suffix', () => {
    render(<Harness onPatch={vi.fn()} />);
    addFromMenu('Condition — reject the save when it is true');
    fireEvent.change(messageBox(), { target: { value: 'No negative' } });
    expect(nameBox().value).toBe('no_negative_2');
  });

  it('a message with no Latin letters keeps the minted name', () => {
    render(<Harness onPatch={vi.fn()} />);
    addFromMenu('Condition — reject the save when it is true');
    fireEvent.change(messageBox(), { target: { value: '工时超过 四十' } });
    expect(nameBox().value).toBe('validation_2');
  });

  it('CONTROL — editing an authored rule’s message keeps its name', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    fireEvent.click(screen.getByText('no_negative'));
    fireEvent.change(messageBox(), { target: { value: 'Hours must be zero or more' } });
    expect(nameBox().value).toBe('no_negative');
    expect(lastValidations(onPatch)[0]).toMatchObject({ name: 'no_negative', message: 'Hours must be zero or more' });
  });
});
