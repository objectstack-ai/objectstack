/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The JSON editor `json` now resolves to (objectui#11448), held to what a
 * `json` value can be.
 *
 * `json` used to alias `field:code`, a raw-text editor: an object rendered as
 * `[object Object]` and an edit saved as a string. It now aliases
 * `field:object` — `ObjectField`, the editor `object` / `composite` / `record`
 * already used — so ONE widget edits the four free-form JSON types. The form-level
 * measurement lives in `@object-ui/plugin-form`'s
 * `ModalForm.jsonField-11448.test.tsx`; this file pins the widget's own
 * properties that the `json` type depends on:
 *
 *  - a json value need not be an object, so arrays, numbers, strings, booleans
 *    and `null` must display and parse back faithfully;
 *  - the read-only face must not call a stored `0` or `false` empty;
 *  - an unparsable draft stays in the box (the sync effect used to replace it
 *    on every keystroke) and marks the control invalid for the browser's
 *    constraint validation, which is what stops a form submitting it;
 *  - the inline editors (grid cell, detail panel) reach the same widget.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import React, { useState } from 'react';

import { ObjectField } from '../widgets/ObjectField';
import { FieldEditWidget, hasFieldEditWidget, isInlineExcludedFieldType, mapFieldTypeToFormType } from '../index';

afterEach(() => cleanup());

const jsonField = { name: 'payload', label: 'Payload', type: 'json' } as any;

const textarea = (container: HTMLElement) => container.querySelector('textarea') as HTMLTextAreaElement;

/** A host that echoes every emission back, as react-hook-form does. */
function EchoHost({ initial, onEmit }: { initial: unknown; onEmit?: (v: unknown) => void }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <ObjectField
      value={value}
      onChange={(v) => {
        onEmit?.(v);
        setValue(v);
      }}
      field={jsonField}
    />
  );
}

describe('json resolves to the JSON editor, code stays the code editor (objectui#11448)', () => {
  it('maps json to field:object and leaves code on field:code', () => {
    expect(mapFieldTypeToFormType('json')).toBe('field:object');
    expect(mapFieldTypeToFormType('code')).toBe('field:code');
  });

  it('keeps json inline-editable rather than folding it into the container exclusion', () => {
    expect(hasFieldEditWidget('json')).toBe(true);
    expect(isInlineExcludedFieldType('json')).toBe(false);
    // The aliased container spellings stay excluded — of the four types that
    // resolve to `field:object`, `json` is the one with a direct inline entry.
    expect(isInlineExcludedFieldType('composite')).toBe(true);
  });

  it('the inline editor renders the same face as the form', () => {
    const onChange = vi.fn();
    const { container } = render(
      <FieldEditWidget field={jsonField} value={{ a: 1 }} onChange={onChange} />,
    );
    expect(textarea(container).value).toBe(JSON.stringify({ a: 1 }, null, 2));
    fireEvent.change(textarea(container), { target: { value: '{"b":2}' } });
    expect(onChange).toHaveBeenLastCalledWith({ b: 2 });
  });
});

describe('a json value need not be an object (objectui#11448)', () => {
  it.each([
    ['an array', [1, 2, 3]],
    ['a number', 42],
    ['zero', 0],
    ['a string', 'hello'],
    ['false', false],
  ])('displays %s as its JSON text', (_label, stored) => {
    const { container } = render(<ObjectField value={stored} onChange={vi.fn()} field={jsonField} />);
    expect(textarea(container).value).toBe(JSON.stringify(stored, null, 2));
  });

  it.each([
    ['[1,2]', [1, 2]],
    ['42', 42],
    ['0', 0],
    ['"hi"', 'hi'],
    ['false', false],
    ['null', null],
  ])('parses %s back to its value', (typed, expected) => {
    const onChange = vi.fn();
    const { container } = render(<ObjectField value={undefined} onChange={onChange} field={jsonField} />);
    fireEvent.change(textarea(container), { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });
});

describe('the read-only face states a falsy json value (objectui#11448)', () => {
  it.each([
    ['0', 0],
    ['false', false],
    ['[]', []],
  ])('prints %s rather than the empty affordance', (printed, stored) => {
    const { container } = render(<ObjectField value={stored} onChange={vi.fn()} field={jsonField} readonly />);
    expect(container.querySelector('pre')?.textContent).toBe(printed);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('draws the empty affordance for %s, as the json cell does', (_label, stored) => {
    const { container } = render(<ObjectField value={stored} onChange={vi.fn()} field={jsonField} readonly />);
    expect(container.querySelector('pre')).toBeNull();
  });
});

describe('an unparsable draft stays in the box and is refused (objectui#11448)', () => {
  it('keeps each keystroke when the host does not echo (an empty field)', () => {
    const onChange = vi.fn();
    const { container } = render(<ObjectField value={null} onChange={onChange} field={jsonField} />);
    for (const draft of ['{', '{"a"', '{"a":']) {
      fireEvent.change(textarea(container), { target: { value: draft } });
      expect(textarea(container).value, `lost the draft ${draft}`).toBe(draft);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an unparsable draft that follows a valid one under an echoing host', () => {
    const emitted: unknown[] = [];
    const { container } = render(<EchoHost initial={{ a: 1 }} onEmit={(v) => emitted.push(v)} />);
    fireEvent.change(textarea(container), { target: { value: '{"a":2}' } });
    fireEvent.change(textarea(container), { target: { value: '{"a":2' } });
    expect(textarea(container).value).toBe('{"a":2');
    expect(emitted).toEqual([{ a: 2 }]);
  });

  it('marks the control invalid for constraint validation, and clears it once the text parses', () => {
    const { container } = render(<EchoHost initial={{ a: 1 }} />);
    fireEvent.change(textarea(container), { target: { value: '{"a":' } });
    expect(textarea(container).validity.customError).toBe(true);
    expect(textarea(container).validationMessage).toBe('Invalid JSON');
    expect(textarea(container).getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(textarea(container), { target: { value: '{"a":3}' } });
    expect(textarea(container).validity.customError).toBe(false);
    expect(textarea(container).getAttribute('aria-invalid')).toBe('false');
  });

  it('still adopts a value that changes outside the box', () => {
    const { container, rerender } = render(<ObjectField value={undefined} onChange={vi.fn()} field={jsonField} />);
    expect(textarea(container).value).toBe('');
    rerender(<ObjectField value={{ loaded: true }} onChange={vi.fn()} field={jsonField} />);
    expect(textarea(container).value).toBe(JSON.stringify({ loaded: true }, null, 2));
  });
});
