/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Inline edit delegates the destructive/type-lossy tail to `FieldEditWidget`
 * (objectui#4220 — the remainder of the #4216 fall-through sweep).
 *
 * `InlineFieldInput` ends in a raw text input. Anything its type switch does
 * not match landed there, was DISPLAYED through `coerceToSafeValue` and was
 * WRITTEN back as whatever the user typed — a bare string. Two damage classes
 * survived #4216 (structured objects) and #4228 (containers + credentials,
 * closed at the host gate):
 *
 *  - **class A, array-valued** — `tags` / `checkboxes` / an options-less multi
 *    picklist store a `string[]`. `coerceToSafeValue`'s array case is
 *    `.join(', ')`, so `['alpha','beta']` was offered for editing as the single
 *    string `"alpha, beta"` and saved back as that string: the array is gone,
 *    and with it every consumer that indexes it.
 *  - **class C, type-lossy scalars** — `toggle` (boolean), `slider` /
 *    `progress` / `rating` (number), `radio` (one of `options`). The value
 *    round-trips through `String()` and comes back a string, so a boolean
 *    column receives `"true"`, a numeric one `"42"`, and `radio` accepts any
 *    free-typed value its option list does not offer.
 *
 * Both halves are asserted for every type, because either alone is a test that
 * cannot see the real damage: the DISPLAY half misses the write, and a write
 * assertion that only checks "something was emitted" misses the type.
 *
 * The fix is one fallback branch, not per-type routing: a type the switch has
 * no branch for and that is not explicitly benign renders the SAME widget the
 * form uses, via `FieldEditWidget`. The design calls inside class A (what an
 * options-less `checkboxes` shows) resolve inside that delegation — the fields
 * package already owns them.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineFieldInput, INLINE_PLAIN_TEXT_INPUT_TESTID } from '../InlineFieldInput';
import { isInlineExcludedDetailFieldType } from '../fieldEnrichment';

/** The terminal raw text input at the end of `InlineFieldInput`. */
const plainInput = (): HTMLElement | null =>
  screen.queryByTestId(INLINE_PLAIN_TEXT_INPUT_TESTID);

/**
 * Type into whatever the FIRST editable box of the rendered editor happens to
 * be, and hand back what `onChange` emitted — the query-independent probe the
 * #4216 suite introduced. Addressing a sub-control by name would fail on
 * "unable to find an element" BEFORE the fix, which names the missing control
 * rather than the destroyed value; addressing the first box reaches the
 * terminal input before and the widget's own input after, so the assertion is
 * always about the emitted value SHAPE.
 */
function typeIntoFirstBox(container: HTMLElement, text: string): unknown[] {
  const onChangeCalls: unknown[] = [];
  const input = container.querySelector('input, textarea');
  if (input) {
    fireEvent.change(input as HTMLInputElement, { target: { value: text } });
  }
  return onChangeCalls;
}

const OPTIONS = [
  { label: 'Alpha', value: 'alpha' },
  { label: 'Beta', value: 'beta' },
  { label: 'Gamma', value: 'gamma' },
];

// ---------------------------------------------------------------------------
// Class A — array-valued types
// ---------------------------------------------------------------------------

describe('class A — an array-valued field never edits as a joined string (#4220)', () => {
  describe('tags', () => {
    const field = { name: 'labels', type: 'tags' };
    const value = ['alpha', 'beta'];

    it('offers the chip editor, never a box holding the joined "alpha, beta"', () => {
      render(<InlineFieldInput field={field} value={[...value]} onChange={vi.fn()} />);
      // Display half: the join is what the terminal input showed as "the
      // current value I am correcting".
      expect(screen.queryByDisplayValue('alpha, beta')).toBeNull();
      expect(plainInput()).toBeNull();
      // Each element is its own removable chip, as on the form.
      expect(screen.getByLabelText('Remove alpha')).toBeInTheDocument();
      expect(screen.getByLabelText('Remove beta')).toBeInTheDocument();
    });

    it('emits an ARRAY when a tag is added', () => {
      const onChange = vi.fn();
      const { container } = render(
        <InlineFieldInput field={field} value={[...value]} onChange={onChange} />,
      );
      const input = container.querySelector('input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'gamma' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0];
      // Write half — the data-destroying one.
      expect(Array.isArray(next)).toBe(true);
      expect(next).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('emits an ARRAY when a tag is removed', () => {
      const onChange = vi.fn();
      render(<InlineFieldInput field={field} value={[...value]} onChange={onChange} />);
      fireEvent.click(screen.getByLabelText('Remove alpha'));
      expect(Array.isArray(onChange.mock.calls[0][0])).toBe(true);
      expect(onChange.mock.calls[0][0]).toEqual(['beta']);
    });

    it('never emits a bare STRING over the array', () => {
      const onChange = vi.fn();
      const { container } = render(
        <InlineFieldInput field={field} value={[...value]} onChange={onChange} />,
      );
      typeIntoFirstBox(container, 'alpha, beta, gamma');
      for (const call of onChange.mock.calls) {
        expect(typeof call[0]).not.toBe('string');
      }
    });
  });

  describe('checkboxes', () => {
    const field = { name: 'perks', type: 'checkboxes', options: OPTIONS };
    const value = ['alpha', 'beta'];

    it('offers the checkbox group, never the joined string', () => {
      render(<InlineFieldInput field={field} value={[...value]} onChange={vi.fn()} />);
      expect(screen.queryByDisplayValue('alpha, beta')).toBeNull();
      expect(plainInput()).toBeNull();
      expect(screen.getByTestId('checkboxes-option-alpha')).toBeInTheDocument();
      expect(screen.getByTestId('checkboxes-option-gamma')).toBeInTheDocument();
    });

    it('emits an ARRAY when an option is toggled', () => {
      const onChange = vi.fn();
      render(<InlineFieldInput field={field} value={[...value]} onChange={onChange} />);
      fireEvent.click(screen.getByTestId('checkboxes-option-gamma'));
      const next = onChange.mock.calls[0][0];
      expect(Array.isArray(next)).toBe(true);
      expect([...(next as string[])].sort()).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('an options-less `checkboxes` shows the fields package’s unfillable state, not a text box', () => {
      // The design call the card flagged (`CheckboxesField` needs options)
      // resolves INSIDE the delegation: the widget renders its own legible
      // "no options" state, and the array is left untouched — where the
      // terminal input offered "alpha, beta" for overwriting.
      const onChange = vi.fn();
      const { container } = render(
        <InlineFieldInput
          field={{ name: 'perks', type: 'checkboxes' }}
          value={[...value]}
          onChange={onChange}
        />,
      );
      expect(plainInput()).toBeNull();
      expect(screen.queryByDisplayValue('alpha, beta')).toBeNull();
      expect(screen.getByTestId('checkboxes-empty-perks')).toBeInTheDocument();
      typeIntoFirstBox(container, 'wiped');
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('multiselect / select+multiple with no options (the select branch’s guard)', () => {
    // The routed select branch requires `Array.isArray(field.options) &&
    // field.options.length > 0`, so an options-less multi picklist fell
    // straight through to the terminal input with its array joined.
    for (const field of [
      { name: 'topics', type: 'multiselect' },
      { name: 'topics', type: 'select', multiple: true },
    ]) {
      it(`\`${field.type}${field.multiple ? ' + multiple' : ''}\` keeps the array`, () => {
        const onChange = vi.fn();
        const { container } = render(
          <InlineFieldInput field={field} value={['alpha', 'beta']} onChange={onChange} />,
        );
        expect(plainInput()).toBeNull();
        expect(screen.queryByDisplayValue('alpha, beta')).toBeNull();
        expect(screen.getByTestId('multiselect-empty-topics')).toBeInTheDocument();
        typeIntoFirstBox(container, 'wiped');
        expect(onChange).not.toHaveBeenCalled();
      });
    }

    it('a multiselect WITH options still routes to the existing chip picker (control)', () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput
          field={{ name: 'topics', type: 'multiselect', options: OPTIONS }}
          value={['alpha']}
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByTestId('multiselect-option-beta'));
      expect(onChange.mock.calls[0][0]).toEqual(['alpha', 'beta']);
    });
  });

  it('`vector` needs no editor here — #4228 closed it at the host gate', () => {
    // Verification, not a re-fix: the shared exclusion set already stops the
    // hosts from entering inline edit on an embedding vector at all.
    expect(isInlineExcludedDetailFieldType(undefined, 'vector')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Class C — type-lossy scalars
// ---------------------------------------------------------------------------

describe('class C — a scalar field keeps its TYPE through inline edit (#4220)', () => {
  it('`toggle` edits as a switch and emits a BOOLEAN (not "true")', () => {
    const onChange = vi.fn();
    render(
      <InlineFieldInput field={{ name: 'active', type: 'toggle' }} value={true} onChange={onChange} />,
    );
    expect(plainInput()).toBeNull();
    expect(screen.queryByDisplayValue('true')).toBeNull();
    const control = screen.getByRole('switch');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof onChange.mock.calls[0][0]).toBe('boolean');
    expect(onChange.mock.calls[0][0]).toBe(false);
  });

  for (const type of ['slider', 'progress']) {
    it(`\`${type}\` edits as a slider and emits a NUMBER`, () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput
          field={{ name: 'completion', type, min: 0, max: 100, step: 10 }}
          value={40}
          onChange={onChange}
        />,
      );
      expect(plainInput()).toBeNull();
      expect(screen.queryByDisplayValue('40')).toBeNull();
      const slider = screen.getByRole('slider');
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(onChange).toHaveBeenCalled();
      expect(typeof onChange.mock.calls[0][0]).toBe('number');
    });
  }

  it('`rating` edits as stars and emits a NUMBER', () => {
    const onChange = vi.fn();
    render(
      <InlineFieldInput field={{ name: 'score', type: 'rating' }} value={3} onChange={onChange} />,
    );
    expect(plainInput()).toBeNull();
    const stars = screen.getAllByRole('button');
    fireEvent.click(stars[4]);
    expect(typeof onChange.mock.calls[0][0]).toBe('number');
    expect(onChange.mock.calls[0][0]).toBe(5);
  });

  it('`radio` is CONSTRAINED to its options — no free-typed value can be saved', () => {
    // The same argument the routed select branch already makes in its own
    // comment ("users ... can't free-type invalid values"), applied to the
    // widget that was missed.
    const onChange = vi.fn();
    const { container } = render(
      <InlineFieldInput
        field={{ name: 'tier', type: 'radio', options: OPTIONS }}
        value="alpha"
        onChange={onChange}
      />,
    );
    expect(plainInput()).toBeNull();
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(screen.getByTestId('radio-option-beta')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('radio-option-beta'));
    expect(onChange).toHaveBeenCalledWith('beta');
    // Nothing in the rendered editor accepts an off-list value.
    typeIntoFirstBox(container, 'not-an-option');
    for (const call of onChange.mock.calls) {
      expect(OPTIONS.map((o) => o.value)).toContain(call[0]);
    }
  });
});

// ---------------------------------------------------------------------------
// The types the switch never had a branch for (#4228's report)
// ---------------------------------------------------------------------------

describe('types the fields package edits inline but the switch had no branch for', () => {
  // objectui#11448: `json` used to delegate to the CODE editor (alias `json` →
  // `field:code`), which showed a stored object as `[object Object]` and wrote
  // the edited text back as a string. It now reaches the JSON editor the record
  // form uses for the same field — the same face on both surfaces.
  it('`json` delegates to the JSON editor: shows the stored value as JSON, writes the parsed value', () => {
    const onChange = vi.fn();
    const { container } = render(
      <InlineFieldInput
        field={{ name: 'payload', type: 'json' }}
        value={{ a: 1 }}
        onChange={onChange}
      />,
    );
    expect(plainInput()).toBeNull();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe(JSON.stringify({ a: 1 }, null, 2));
    fireEvent.change(textarea, { target: { value: '{"a":2}' } });
    expect(onChange).toHaveBeenLastCalledWith({ a: 2 });
  });

  it('`json` refuses unparsable text inline: nothing is written, and the box says why', () => {
    const onChange = vi.fn();
    const { container } = render(
      <InlineFieldInput field={{ name: 'payload', type: 'json' }} value={{ a: 1 }} onChange={onChange} />,
    );
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"a":' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe('{"a":');
    expect(container.textContent).toContain('Invalid JSON');
  });

  it('`code` delegates to the code editor', () => {
    const { container } = render(
      <InlineFieldInput field={{ name: 'src', type: 'code' }} value="x = 1" onChange={vi.fn()} />,
    );
    expect(plainInput()).toBeNull();
    expect(container.querySelector('textarea')).not.toBeNull();
  });

  it('`color` delegates to the colour picker', () => {
    const { container } = render(
      <InlineFieldInput field={{ name: 'brand', type: 'color' }} value="#ff0000" onChange={vi.fn()} />,
    );
    expect(plainInput()).toBeNull();
    expect(container.querySelector('input[type="color"]')).not.toBeNull();
  });

  it('`time` delegates to the native time picker', () => {
    const { container } = render(
      <InlineFieldInput field={{ name: 'starts', type: 'time' }} value="09:30" onChange={vi.fn()} />,
    );
    expect(plainInput()).toBeNull();
    expect(container.querySelector('input[type="time"]')).not.toBeNull();
  });

  it('`qrcode` delegates to its form widget', () => {
    render(
      <InlineFieldInput field={{ name: 'ticket', type: 'qrcode' }} value="OS-1" onChange={vi.fn()} />,
    );
    expect(plainInput()).toBeNull();
    expect(screen.getByDisplayValue('OS-1')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Class D — benign already-string types keep the terminal input
// ---------------------------------------------------------------------------

describe('class D — benign string types keep the terminal text input (#4220)', () => {
  // `textarea` stood in this list until objectui#11562 routed it to the
  // multi-line `TextAreaField`; its pins are
  // `InlineFieldInput.textareaEditor-11562.test.tsx`.
  for (const type of ['text', 'email', 'url', 'phone']) {
    it(`\`${type}\` still edits in the plain input, and emits the typed string`, () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput field={{ name: 'f', type }} value="before" onChange={onChange} />,
      );
      const input = plainInput();
      expect(input).not.toBeNull();
      expect((input as HTMLInputElement).value).toBe('before');
      fireEvent.change(input as HTMLInputElement, { target: { value: 'after' } });
      expect(onChange).toHaveBeenCalledWith('after');
    });
  }

  it('an options-less single `select` keeps the plain input (no picklist to render)', () => {
    // Stringification is the identity for a bare string value, and the
    // fields package's own empty state would leave the user unable to enter
    // anything at all. The array-valued spelling is class A above.
    const onChange = vi.fn();
    render(
      <InlineFieldInput field={{ name: 'stage', type: 'select' }} value="alpha" onChange={onChange} />,
    );
    expect(plainInput()).not.toBeNull();
    fireEvent.change(plainInput() as HTMLInputElement, { target: { value: 'beta' } });
    expect(onChange).toHaveBeenCalledWith('beta');
  });
});

// ---------------------------------------------------------------------------
// Controls — every currently-routed family keeps its editor
// ---------------------------------------------------------------------------

describe('controls — the routed families are untouched by the delegation', () => {
  it('`select` with options keeps the routed dropdown', () => {
    render(
      <InlineFieldInput
        field={{ name: 'stage', type: 'select', options: OPTIONS }}
        value="alpha"
        onChange={vi.fn()}
      />,
    );
    expect(plainInput()).toBeNull();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('`boolean` keeps the routed switch', () => {
    const onChange = vi.fn();
    render(
      <InlineFieldInput field={{ name: 'active', type: 'boolean' }} value={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('`number` keeps the routed numeric input', () => {
    const { container } = render(
      <InlineFieldInput field={{ name: 'qty', type: 'number' }} value={7} onChange={vi.fn()} />,
    );
    expect(plainInput()).toBeNull();
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
  });

  // objectui#12759: `date` / `datetime` left the routed native date input and
  // delegate here, to the platform date picker the grid cell draws. A
  // `datetime` shows its time, which the date-only control could not hold.
  for (const [type, shown] of [
    ['date', /^08\/11\/2026$/],
    ['datetime', /^08\/11\/2026, 0?2:30\s?PM$/],
  ] as const) {
    it(`\`${type}\` delegates to the platform date picker, not \`input[type=date]\``, async () => {
      const { container } = render(
        <InlineFieldInput
          field={{ name: 'due', type }}
          value="2026-08-11T14:30:00.000Z"
          onChange={vi.fn()}
        />,
      );
      const input = await waitFor(() => {
        const el = container.querySelector('[data-slot="date-picker"] input');
        if (!el) throw new Error('date picker not rendered');
        return el as HTMLInputElement;
      });
      expect(container.querySelector('input[type="date"]')).toBeNull();
      expect(plainInput()).toBeNull();
      expect(input.value).toMatch(shown);
    });
  }

  it('`address` keeps the routed sub-field editor (#4222)', () => {
    render(
      <InlineFieldInput
        field={{ name: 'billing', type: 'address' }}
        value={{ street: '123 Main St', city: 'San Francisco' }}
        onChange={vi.fn()}
      />,
    );
    expect(plainInput()).toBeNull();
    expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument();
    expect(screen.getByDisplayValue('San Francisco')).toBeInTheDocument();
  });

  it('`lookup` keeps the routed record picker', () => {
    const { container } = render(
      <InlineFieldInput
        field={{ name: 'account', type: 'lookup', reference: 'crm_account' }}
        value={{ id: 'a1', name: 'Northwind' }}
        onChange={vi.fn()}
        dataSource={{ find: vi.fn(async () => ({ data: [], total: 0 })) }}
      />,
    );
    expect(plainInput()).toBeNull();
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });

  it('`image` keeps the routed upload widget (the #4228 exemption)', () => {
    render(
      <InlineFieldInput field={{ name: 'logo', type: 'image' }} value={null} onChange={vi.fn()} />,
    );
    expect(plainInput()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// autoFocus — the delegation follows the routed branches' convention
// ---------------------------------------------------------------------------

describe('autoFocus reaches the delegated widget’s own control', () => {
  it('`tags` focuses the chip input when the host enters edit on that field', () => {
    const { container } = render(
      <InlineFieldInput
        field={{ name: 'labels', type: 'tags' }}
        value={['alpha']}
        onChange={vi.fn()}
        autoFocus
      />,
    );
    expect(container.querySelector('input')).toBe(document.activeElement);
  });

  it('`code` focuses the editor', () => {
    const { container } = render(
      <InlineFieldInput
        field={{ name: 'src', type: 'code' }}
        value="x = 1"
        onChange={vi.fn()}
        autoFocus
      />,
    );
    expect(container.querySelector('textarea')).toBe(document.activeElement);
  });
});
