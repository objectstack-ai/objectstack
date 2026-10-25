/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Studio's object settings panel picks with the shared `Select` (objectui#11865).
 *
 * The Settings tab picked the sharing model, the name field, the lifecycle
 * field and the next highlight field with browser-native
 * selects, beside the shared Radix `Select` the rest of Studio picks with. The
 * card asks for one control for one kind of choice, surface by surface; this
 * suite covers this panel's pickers.
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), shows the
 *     object's value, and no native select is left;
 *   - the three labelled pickers keep the name their wrapping label gave the
 *     native control; the "add field" picker had no label and still has no
 *     name;
 *   - every option of every picker writes the `onPatch` payload the native
 *     control wrote, compared as JSON text, with the keys that hold
 *     `undefined` named (JSON text drops them). That covers each "not set",
 *     "auto-derived" and "auto-detect" option, which writes its key holding
 *     `undefined`, and "None", which writes `stageField: false`;
 *   - re-picking the current option writes nothing, and neither does
 *     "add field";
 *   - read-only: each trigger is disabled, wears the primitive's own disabled
 *     look, and does not open; the "add field" picker is not drawn, as before;
 *   - a stored value no option carries is what the trigger shows;
 *   - the keyboard alone opens a picker and selects.
 *
 * DIRECTION, observed against the native control: every pin here is red
 * there, because each one reads the pickers as the primitive's triggers. What
 * makes the write pins guards of "the conversion changed nothing the panel
 * writes" is the literal each compares against: a `change` event on the
 * pre-conversion panel's native control wrote that same JSON, with the same
 * `undefined` keys, read once on that component. The names were read there
 * the same way. That probe's `change` event fired for the current option too,
 * so the re-pick rows pin the primitive, not a browser reading of the native
 * control.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Select, SelectTrigger, SelectValue } from '@object-ui/components';
import { t } from '../metadata-admin/i18n';
import { ObjectSettingsPanel } from './ObjectSettingsPanel';

afterEach(cleanup);

const en = (key: string) => t(key, 'en-US');

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  status: { type: 'select', label: 'Status' },
  stage: { type: 'select' },
  secret: { type: 'text', label: 'Secret', hidden: true },
  code: { label: 'Code' },
};

/** An object with every picker set to one of its own options. */
const DRAFT: Record<string, unknown> = {
  fields: FIELDS,
  sharingModel: 'public_read',
  nameField: 'name',
  stageField: 'status',
  highlightFields: ['name'],
};

const PICKERS = [
  'owd-internal-select',
  'name-field-select',
  'stage-field-select',
  'highlight-add-select',
] as const;

/** The labelled pickers, by the i18n key of the label that names each. */
const NAMED_BY: ReadonlyArray<readonly [string, string]> = [
  ['owd-internal-select', 'engine.studio.settings.sharingModel'],
  ['name-field-select', 'engine.studio.settings.nameField'],
  ['stage-field-select', 'engine.studio.settings.stageField'],
];

function renderPanel(draft: Record<string, unknown> = DRAFT, disabled?: boolean) {
  const onPatch = vi.fn();
  const utils = render(
    <ObjectSettingsPanel name="leave_request" draft={draft} onPatch={onPatch} disabled={disabled} locale="en-US" />,
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

describe('the object settings pickers are the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, showing the object’s value', () => {
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
      'owd-internal-select': en('engine.studio.settings.sharingPublicRead'),
      'name-field-select': 'Name (name)',
      'stage-field-select': 'Status (status)',
      'highlight-add-select': en('engine.studio.settings.addFieldOption'),
    });
  });

  it('each labelled picker keeps the name its label gave the native control', () => {
    renderPanel();
    for (const [id, key] of NAMED_BY) {
      expect(screen.getByRole('combobox', { name: en(key) }), id).toBe(screen.getByTestId(id));
    }
  });

  it('the "add field" picker had no label and still has no name', () => {
    renderPanel();
    expect(screen.getByRole('combobox', { name: '' })).toBe(screen.getByTestId('highlight-add-select'));
  });

  it('"None" on the lifecycle field is what the trigger shows for stageField: false', () => {
    renderPanel({ ...DRAFT, stageField: false });
    expect(screen.getByTestId('stage-field-select')).toHaveTextContent(en('engine.studio.settings.stageNone'));
  });
});

/**
 * [picker, option label, the JSON text `onPatch` received, the keys of the
 * patch that hold `undefined`]. `null`: nothing is written — the option is the
 * current one, or it is "add field".
 */
const WRITES: ReadonlyArray<readonly [string, string, string | null, readonly string[]]> = [
  ['owd-internal-select', en('engine.studio.settings.sharingUnset'), '{}', ['sharingModel']],
  ['owd-internal-select', en('engine.studio.settings.sharingPrivate'), '{"sharingModel":"private"}', []],
  ['owd-internal-select', en('engine.studio.settings.sharingPublicRead'), null, []],
  ['owd-internal-select', en('engine.studio.settings.sharingPublicReadWrite'), '{"sharingModel":"public_read_write"}', []],
  ['owd-internal-select', en('engine.studio.settings.sharingControlledByParent'), '{"sharingModel":"controlled_by_parent"}', []],
  ['name-field-select', en('engine.studio.settings.autoDerive'), '{}', ['nameField']],
  ['name-field-select', 'Name (name)', null, []],
  ['name-field-select', 'Status (status)', '{"nameField":"status"}', []],
  ['name-field-select', 'stage', '{"nameField":"stage"}', []],
  ['name-field-select', 'Secret (secret)', '{"nameField":"secret"}', []],
  ['name-field-select', 'Code (code)', '{"nameField":"code"}', []],
  ['stage-field-select', en('engine.studio.settings.autoDetect'), '{}', ['stageField']],
  ['stage-field-select', en('engine.studio.settings.stageNone'), '{"stageField":false}', []],
  ['stage-field-select', 'Status (status)', null, []],
  ['stage-field-select', 'stage', '{"stageField":"stage"}', []],
  ['highlight-add-select', en('engine.studio.settings.addFieldOption'), null, []],
  ['highlight-add-select', 'Status (status)', '{"highlightFields":["name","status"]}', []],
  ['highlight-add-select', 'stage', '{"highlightFields":["name","stage"]}', []],
  ['highlight-add-select', 'Code (code)', '{"highlightFields":["name","code"]}', []],
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
      const patch = onPatch.mock.calls[0][0] as Record<string, unknown>;
      expect(JSON.stringify(patch)).toBe(json);
      expect(Object.keys(patch).filter((k) => patch[k] === undefined)).toEqual(undefinedKeys);
    },
  );
});

describe('read-only follows the primitive (objectui#11781)', () => {
  it('each picker is disabled, wears the primitive’s disabled look, and does not open', () => {
    const look = primitiveDisabledLook();
    expect(look.length, 'the primitive carries no disabled look to compare with').toBeGreaterThan(0);
    const { onPatch } = renderPanel(DRAFT, true);
    for (const [id] of NAMED_BY) {
      const trigger = screen.getByTestId(id);
      expect(trigger).toBeDisabled();
      for (const token of look) expect(trigger, `${id} lacks ${token}`).toHaveClass(token);
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(screen.queryByRole('listbox'), `${id} opened while read-only`).toBeNull();
    }
    // As before the conversion, read-only draws no "add field" picker at all.
    expect(screen.queryByTestId('highlight-add-select')).toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('CONTROL — writable: the same pickers are drawn and enabled', () => {
    renderPanel();
    for (const id of PICKERS) expect(screen.getByTestId(id)).toBeEnabled();
  });
});

describe('a stored value no option carries is what the trigger shows', () => {
  it('a name field the object does not have: shown and listed first, and re-picking it writes nothing', async () => {
    const { onPatch } = renderPanel({ ...DRAFT, nameField: 'ghost' });
    // The native control showed "(auto-derived)" here, as if no name field were set.
    expect(screen.getByTestId('name-field-select')).toHaveTextContent('ghost');
    const listed = (await openPicker('name-field-select')).map((o) => o.textContent);
    expect(listed).toEqual([
      'ghost',
      en('engine.studio.settings.autoDerive'),
      'Name (name)',
      'Status (status)',
      'stage',
      'Secret (secret)',
      'Code (code)',
    ]);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('a lifecycle field that is not a select field is shown, not "auto-detect"', () => {
    renderPanel({ ...DRAFT, stageField: 'name' });
    expect(screen.getByTestId('stage-field-select')).toHaveTextContent('name');
  });

  it('a sharing model the dial does not offer is shown, not "not set"', () => {
    renderPanel({ ...DRAFT, sharingModel: 'full' });
    expect(screen.getByTestId('owd-internal-select')).toHaveTextContent('full');
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens a picker and Enter on an option selects it', async () => {
    const { onPatch } = renderPanel();
    fireEvent.keyDown(screen.getByTestId('stage-field-select'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'stage' }), { key: 'Enter' });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onPatch.mock.calls[0][0])).toBe('{"stageField":"stage"}');
  });
});
