/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A number bound typed before `getObjectSchema` answers is never stored as a
 * string (objectstack#35057).
 *
 * The widget draws a stored row as soon as it mounts, but the row's value box
 * is typed from the object schema, which arrives later. Until it did, the box
 * was a TEXT input, and a bound typed into it was emitted as the string it
 * held: with the schema held back, typing `6` into a stored `$gt` row emitted
 * `{"amount":{"$gt":"6"}}`, and the schema's arrival retyped the box to a
 * number input without re-emitting, so the string was what got saved. With the
 * schema answering first the same keystroke emitted `{"amount":{"$gt":6}}`.
 * The stored document depended on a network race.
 *
 * What is pinned is the EMITTED document, beside the browser-level fact that
 * the controls are disabled while the read is in flight. Both bounds of the
 * hold are pinned too: a failed read releases it, and a host with no
 * `getObjectSchema` never holds, because no answer is coming.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterConditionField } from '../FilterConditionField';

const OBJECT_SCHEMA = {
  name: 'account',
  fields: [{ name: 'amount', label: 'Amount', type: 'number' }],
};

/** A `getObjectSchema` that answers only when the test says so. */
function heldSchema(answer: () => Promise<unknown>) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dataSource = {
    getObjectSchema: async () => {
      await gate;
      return answer();
    },
  };
  return { dataSource, release: () => act(async () => release()) };
}

/** The widget under its real contract: a parent that stores what it emits. */
function renderWidget(initial: string, dataSource: unknown) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = React.useState<string | object>(initial);
    return (
      <FilterConditionField
        value={value}
        onChange={(next: string | object) => {
          onChange(next);
          setValue(next);
        }}
        dataSource={dataSource}
        dependentValues={{ object_name: 'account' }}
        field={{ name: 'criteria_json', type: 'textarea' }}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

const emitted = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.map((c) => String(c[0]));

describe('a number bound and a schema that has not answered yet', () => {
  it.each([
    ['implicit equality', '{"amount":5}', '{"amount":6}'],
    ['$gt', '{"amount":{"$gt":5}}', '{"amount":{"$gt":6}}'],
    ['$lte', '{"amount":{"$lte":5}}', '{"amount":{"$lte":6}}'],
  ])('%s: no edit is taken before the answer, and the bound typed after it is a number', async (_label, stored, typed) => {
    const { dataSource, release } = heldSchema(async () => OBJECT_SCHEMA);
    const onChange = renderWidget(stored, dataSource);

    // The stored row is on screen, but its box takes no input yet.
    const early = await screen.findByDisplayValue('5');
    expect(early).toBeDisabled();
    // A browser sends no input to a disabled control; a change event fired at
    // it anyway is still not emitted. (`7`, so the post-answer `6` below is a
    // real change of the box's value.)
    fireEvent.change(early, { target: { value: '7' } });
    expect(onChange).not.toHaveBeenCalled();

    await release();
    const box = await screen.findByRole('spinbutton');
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: '6' } });
    expect(emitted(onChange)).toEqual([typed]);
    for (const doc of emitted(onChange)) {
      expect(doc, 'a string comparand reached storage').not.toMatch(/"[67]"/);
    }
  });

  it('CONTROL: the schema answering first emits the same number straight away', async () => {
    const onChange = renderWidget('{"amount":{"$gt":5}}', { getObjectSchema: async () => OBJECT_SCHEMA });
    const box = await screen.findByRole('spinbutton');
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: '6' } });
    expect(emitted(onChange)).toEqual(['{"amount":{"$gt":6}}']);
  });
});

describe('the bounds of the hold', () => {
  it('a failed schema read releases the builder', async () => {
    const { dataSource, release } = heldSchema(async () => {
      throw new Error('schema read failed');
    });
    const onChange = renderWidget('{"amount":5}', dataSource);
    expect(await screen.findByDisplayValue('5')).toBeDisabled();

    await release();
    const box = screen.getByDisplayValue('5');
    expect(box).toBeEnabled();
    // No schema, no type: the box holds text, and the edit is taken as typed.
    fireEvent.change(box, { target: { value: '6' } });
    expect(emitted(onChange)).toEqual(['{"amount":"6"}']);
  });

  it('a host with no getObjectSchema never holds the builder', async () => {
    const onChange = renderWidget('{"amount":5}', {});
    const box = await screen.findByDisplayValue('5');
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: '6' } });
    expect(emitted(onChange)).toEqual(['{"amount":"6"}']);
  });
});
