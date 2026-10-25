/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The validation rule editor's pickers are the shared `Select` (objectui#11865).
 *
 * The rule editor picked a rule's type, field, built-in format and severity
 * with browser-native selects, beside the condition builder's shared Radix
 * `Select`. The card asks for one control for one kind of choice, surface by
 * surface; this suite covers the validation editor's four pickers.
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), keeps the name
 *     its label gave the native control, and no native select is left;
 *   - every option of every picker writes the `onPatch` payload the native
 *     control wrote, compared as JSON text, key order included, and with the
 *     keys that hold `undefined` named (JSON text drops them). That covers the
 *     field picker's "pick a field" (`field: ''`) and the format picker's
 *     "none" (`format` kept as a key holding `undefined`);
 *   - re-picking the current option writes nothing;
 *   - read-only: each trigger is disabled, wears the primitive's own disabled
 *     look, and does not open;
 *   - a stored value no option carries is what the trigger shows;
 *   - the keyboard alone opens a picker and selects.
 *
 * DIRECTION, observed against the native control: every pin here is red
 * there, because each one reads the pickers by the test ids the primitive's
 * triggers carry. What makes the write pins guards of "the conversion changed
 * nothing the editor writes" is the literal each compares against: a `change`
 * event on the pre-conversion panel's native control wrote that same JSON,
 * with the same `undefined` keys, read once on that component.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Select, SelectTrigger, SelectValue } from '@object-ui/components';
import { ObjectValidationsPanel } from './ObjectValidationsPanel';

afterEach(cleanup);

const fields = {
  status: { type: 'select', label: 'Status' },
  code: { type: 'text', label: 'Code' },
  payload: { type: 'json', label: 'Payload' },
};

/** A `format` rule: its editor carries all four pickers. */
const RULE = {
  type: 'format',
  name: 'code_format',
  message: 'Bad code',
  field: 'code',
  format: 'email',
  severity: 'warning',
  active: true,
};

const PICKERS = ['rule-type', 'rule-field', 'rule-format', 'rule-severity'] as const;

function renderPanel(rule: Record<string, unknown> = RULE, disabled?: boolean) {
  const onPatch = vi.fn();
  const utils = render(
    <ObjectValidationsPanel draft={{ fields, validations: [rule] }} onPatch={onPatch} disabled={disabled} />,
  );
  return { ...utils, onPatch };
}

/** Open a picker from the keyboard and return the options it lists, in order. */
async function openPicker(testId: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(testId: string, label: string): Promise<void> {
  const options = await openPicker(testId);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`${testId} lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

/** The `disabled:` utilities the shared `SelectTrigger` wears. */
function primitiveDisabledLook(): string[] {
  const { getByRole, unmount } = render(
    <Select disabled>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
    </Select>,
  );
  const tokens = getByRole('combobox').className.split(/\s+/).filter((c) => c.startsWith('disabled:'));
  unmount();
  return tokens;
}

describe('the rule editor pickers are the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, named by its label, showing the rule’s value', () => {
    const { container } = renderPanel();
    expect(container.querySelector('select')).toBeNull();

    const shown: Record<string, string> = {};
    for (const id of PICKERS) {
      const trigger = screen.getByTestId(id);
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger).toHaveAttribute('role', 'combobox');
      shown[id] = trigger.textContent ?? '';
    }
    expect(shown).toEqual({
      'rule-type': 'Format — regex / built-in format',
      'rule-field': 'Code (code)',
      'rule-format': 'email',
      'rule-severity': 'warning',
    });

    // The names the native controls had, from the same wrapping labels.
    expect(screen.getByRole('combobox', { name: 'Type' })).toBe(screen.getByTestId('rule-type'));
    expect(screen.getByRole('combobox', { name: 'Field' })).toBe(screen.getByTestId('rule-field'));
    expect(screen.getByRole('combobox', { name: 'Built-in format' })).toBe(screen.getByTestId('rule-format'));
    expect(screen.getByRole('combobox', { name: 'Severity' })).toBe(screen.getByTestId('rule-severity'));
  });

  it('the state machine and JSON schema editors pick their field with it too, writing what the native control wrote', async () => {
    for (const [rule, json] of [
      [
        { type: 'state_machine', name: 'status_flow', message: 'Bad move', field: 'status', transitions: {} },
        '{"validations":[{"type":"state_machine","name":"status_flow","message":"Bad move","field":"code","transitions":{}}]}',
      ],
      [
        { type: 'json_schema', name: 'payload_shape', message: 'Bad payload', field: 'payload', schema: {} },
        '{"validations":[{"type":"json_schema","name":"payload_shape","message":"Bad payload","field":"code","schema":{}}]}',
      ],
    ] as const) {
      const { container, onPatch, unmount } = renderPanel(rule);
      expect(container.querySelector('select')).toBeNull();
      expect(screen.getByTestId('rule-field')).toHaveAttribute('role', 'combobox');
      await pick('rule-field', 'Code (code)');
      expect(onPatch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(onPatch.mock.calls[0][0])).toBe(json);
      unmount();
    }
  });
});

/**
 * [picker, option label, the JSON text `onPatch` received, the keys of the
 * written rule that hold `undefined`]. `null`: the option is the current one,
 * and re-picking it writes nothing.
 */
const WRITES: ReadonlyArray<readonly [string, string, string | null, readonly string[]]> = [
  ['rule-type', 'Script — CEL fail condition', '{"validations":[{"name":"code_format","message":"Bad code","severity":"warning","active":true,"type":"script","condition":"false"}]}', []],
  ['rule-type', 'Cross-field — CEL over multiple fields', '{"validations":[{"name":"code_format","message":"Bad code","severity":"warning","active":true,"type":"cross_field","condition":"false","fields":["status"]}]}', []],
  ['rule-type', 'State machine — allowed transitions', '{"validations":[{"name":"code_format","message":"Bad code","severity":"warning","active":true,"type":"state_machine","field":"status","transitions":{}}]}', []],
  ['rule-type', 'Format — regex / built-in format', null, []],
  ['rule-type', 'JSON schema — validate a JSON field', '{"validations":[{"name":"code_format","message":"Bad code","severity":"warning","active":true,"type":"json_schema","field":"status","schema":{}}]}', []],
  ['rule-type', 'Conditional — apply a rule when a guard holds', '{"validations":[{"name":"code_format","message":"Bad code","severity":"warning","active":true,"type":"conditional","when":"false","then":{"type":"script","name":"code_format_then","message":"","condition":"false","severity":"error"}}]}', []],
  ['rule-field', '— pick a field —', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"","format":"email","severity":"warning","active":true}]}', []],
  ['rule-field', 'Status (status)', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"status","format":"email","severity":"warning","active":true}]}', []],
  ['rule-field', 'Code (code)', null, []],
  ['rule-field', 'Payload (payload)', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"payload","format":"email","severity":"warning","active":true}]}', []],
  ['rule-format', '— none —', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"code","severity":"warning","active":true}]}', ['format']],
  ['rule-format', 'url', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"code","format":"url","severity":"warning","active":true}]}', []],
  ['rule-format', 'email', null, []],
  ['rule-format', 'phone', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"code","format":"phone","severity":"warning","active":true}]}', []],
  ['rule-format', 'json', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"code","format":"json","severity":"warning","active":true}]}', []],
  ['rule-severity', 'error (rejects the save)', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"code","format":"email","severity":"error","active":true}]}', []],
  ['rule-severity', 'warning', null, []],
  ['rule-severity', 'info', '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"code","format":"email","severity":"info","active":true}]}', []],
];

describe('every option writes what the native control wrote', () => {
  it('the table covers every option of every picker, in the order each lists them', async () => {
    for (const id of PICKERS) {
      renderPanel();
      const listed = (await openPicker(id)).map((o) => o.textContent);
      expect(listed, id).toEqual(WRITES.filter(([p]) => p === id).map(([, label]) => label));
      cleanup();
    }
  });

  it.each(WRITES.map((row) => [`${row[0]} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, testId, label, json, undefinedKeys) => {
      const { onPatch } = renderPanel();
      await pick(testId, label);
      if (json === null) {
        expect(onPatch).not.toHaveBeenCalled();
        return;
      }
      expect(onPatch).toHaveBeenCalledTimes(1);
      const written = onPatch.mock.calls[0][0] as { validations: Array<Record<string, unknown>> };
      expect(JSON.stringify(written)).toBe(json);
      const rule = written.validations[0];
      expect(Object.keys(rule).filter((k) => rule[k] === undefined)).toEqual(undefinedKeys);
    },
  );
});

describe('read-only follows the primitive (objectui#11781)', () => {
  it('each picker is disabled, wears the primitive’s disabled look, and does not open', () => {
    const look = primitiveDisabledLook();
    expect(look.length, 'the primitive carries no disabled look to compare with').toBeGreaterThan(0);
    const { onPatch } = renderPanel(RULE, true);
    for (const id of PICKERS) {
      const trigger = screen.getByTestId(id);
      expect(trigger).toBeDisabled();
      for (const token of look) expect(trigger, `${id} lacks ${token}`).toHaveClass(token);
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(screen.queryByRole('listbox'), `${id} opened while read-only`).toBeNull();
    }
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('CONTROL — writable: the same pickers are enabled', () => {
    renderPanel();
    for (const id of PICKERS) expect(screen.getByTestId(id)).toBeEnabled();
  });
});

describe('a stored value no option carries is what the trigger shows', () => {
  it('a field the object does not have: shown and listed first, and re-picking it writes nothing', async () => {
    const { onPatch } = renderPanel({ ...RULE, field: 'ghost' });
    // The native control showed "— pick a field —" here, as if no field were set.
    expect(screen.getByTestId('rule-field')).toHaveTextContent('ghost');
    const listed = (await openPicker('rule-field')).map((o) => o.textContent);
    expect(listed).toEqual(['ghost', '— pick a field —', 'Status (status)', 'Code (code)', 'Payload (payload)']);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('a severity the editor does not offer is shown, not the first option', () => {
    renderPanel({ ...RULE, severity: 'critical' });
    // The native control showed "error (rejects the save)" here.
    expect(screen.getByTestId('rule-severity')).toHaveTextContent('critical');
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens a picker and Enter on an option selects it', async () => {
    const { onPatch } = renderPanel();
    fireEvent.keyDown(screen.getByTestId('rule-severity'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'info' }), { key: 'Enter' });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onPatch.mock.calls[0][0])).toBe(
      '{"validations":[{"type":"format","name":"code_format","message":"Bad code","field":"code","format":"email","severity":"info","active":true}]}',
    );
  });
});
