/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineFieldInput } from '../InlineFieldInput';

/**
 * Type into whatever the FIRST editable box of the rendered editor happens to
 * be, and hand back what `onChange` emitted.
 *
 * Deliberately query-INDEPENDENT. The obvious way to pin the write half is
 * `fireEvent.change(screen.getByDisplayValue('San Francisco'), …)`, but that
 * sub-input does not exist before the fix, so the test fails on "unable to find
 * an element" — a signature that names the missing SUB-INPUT and says nothing
 * about the missing structured write. Those are two different defects, and the
 * data-destroying one is the second.
 *
 * Addressing the first `<input>` instead reaches the terminal text box before
 * the fix and the first sub-field after it, so the assertion that follows is
 * always about the emitted VALUE SHAPE: before → `'…'` (a string that replaces
 * the whole object), after → an object. That is the half this issue is about.
 */
function typeIntoFirstBox(container: HTMLElement, text: string): void {
  const input = container.querySelector('input');
  expect(input).not.toBeNull();
  fireEvent.change(input as HTMLInputElement, { target: { value: text } });
}

/**
 * Structured-composite inline editing (objectui#4216).
 *
 * `InlineFieldInput`'s type switch used to route only the scalar and relational
 * families; every STRUCTURED-object type fell through to the terminal raw text
 * input at the end of the component. That fallback stringifies an object value
 * through `coerceToSafeValue`, which has no branch for any of these shapes — an
 * address / location / geolocation carries none of `name` / `label` /
 * `externalId` / `id` / `_id`, so its general-object case returns the literal
 * `[Object]`.
 *
 * The defect has TWO halves, and both are pinned for every type below, because
 * either one alone is a test that cannot see the real damage:
 *
 *  1. **Display** — the edit box reads `[Object]`, so `[Object]` is what the
 *     user sees as "the current value I am correcting".
 *  2. **Write** — the box is a plain `<input>` wired to `onChange(v)`, so
 *     whatever is typed is emitted as a STRING that replaces the structured
 *     object on save. An ordinary inline edit destroys the sub-field structure.
 *
 * Half 2 is the data-destroying one and it is invisible to a display-only
 * assertion, so each type asserts the emitted value is an OBJECT and that
 * sub-fields the user did not touch survive the round-trip.
 *
 * Assertions are provider-free (matching the sibling `InlineFieldInput` suite)
 * so they hold whether or not i18n / permission providers are mounted.
 */
describe('InlineFieldInput — structured composite values (objectui#4216)', () => {
  describe('address', () => {
    const ADDRESS = {
      street: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94102',
      country: 'United States',
    };

    it('renders the real sub-field editor, never a single box reading "[Object]"', () => {
      render(
        <InlineFieldInput
          field={{ name: 'billing_address', type: 'address' }}
          value={{ ...ADDRESS }}
          onChange={vi.fn()}
        />,
      );
      // Half 1: the stringified placeholder must not be the editable value.
      expect(screen.queryByDisplayValue('[Object]')).toBeNull();
      expect(screen.queryByText('[Object]')).toBeNull();
      // Every sub-field is separately editable, the way the form path renders it.
      expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument();
      expect(screen.getByDisplayValue('San Francisco')).toBeInTheDocument();
      expect(screen.getByDisplayValue('CA')).toBeInTheDocument();
      expect(screen.getByDisplayValue('94102')).toBeInTheDocument();
      expect(screen.getByDisplayValue('United States')).toBeInTheDocument();
    });

    it('emits a STRUCTURED OBJECT on edit, preserving the untouched sub-fields', () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput
          field={{ name: 'billing_address', type: 'address' }}
          value={{ ...ADDRESS }}
          onChange={onChange}
        />,
      );
      fireEvent.change(screen.getByDisplayValue('San Francisco'), {
        target: { value: 'Oakland' },
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0];
      // Half 2: an object, NOT a string — this is the data-destroying half.
      expect(typeof next).toBe('object');
      expect(next).not.toBeNull();
      expect(next).toEqual({ ...ADDRESS, city: 'Oakland' });
    });

    it('never emits a bare STRING that replaces the whole object', () => {
      const onChange = vi.fn();
      const { container } = render(
        <InlineFieldInput
          field={{ name: 'billing_address', type: 'address' }}
          value={{ ...ADDRESS }}
          onChange={onChange}
        />,
      );
      typeIntoFirstBox(container, 'Oakland');
      expect(onChange).toHaveBeenCalledTimes(1);
      // The signature that matters: before the routing fix this is the string
      // 'Oakland', which overwrites `{ street, city, state, postalCode,
      // country }` wholesale on save.
      expect(typeof onChange.mock.calls[0][0]).not.toBe('string');
      expect(typeof onChange.mock.calls[0][0]).toBe('object');
    });

    it('auto-focuses the first sub-input when autoFocus is set', () => {
      render(
        <InlineFieldInput
          field={{ name: 'billing_address', type: 'address' }}
          value={{ ...ADDRESS }}
          onChange={vi.fn()}
          autoFocus
        />,
      );
      // Same convention as the other routed widgets: focus lands on the first
      // focusable control of the editor, here the street line.
      expect(screen.getByDisplayValue('123 Main St')).toHaveFocus();
    });

    it('renders empty sub-inputs for a null value instead of a blank text box', () => {
      render(
        <InlineFieldInput
          field={{ name: 'billing_address', type: 'address' }}
          value={null}
          onChange={vi.fn()}
        />,
      );
      // The composite is still the editor when there is nothing stored yet —
      // that is how an address gets authored inline in the first place.
      //
      // Located by LABEL, not by placeholder (objectui#4028). The sub-inputs
      // used to be reachable as `getByPlaceholderText('123 Main St')`, but
      // those placeholders were hardcoded US example text shown to every
      // locale and are gone. The labels are the durable handle and the better
      // one: they are what names each empty box for a user, and this suite is
      // provider-free, so they resolve through `FIELD_DEFAULTS`' English.
      expect(screen.getByLabelText('Street Address')).toBeInTheDocument();
      expect(screen.getByLabelText('City')).toBeInTheDocument();
    });
  });

  describe('location', () => {
  // ⚠️ `location` values here are the SPEC spelling `{ lat, lng }`
  // (objectui#6272). `@objectstack/spec/data` exports `LocationValue = { lat,
  // lng, altitude?, accuracy? }` as canonical and `valueSchemaFor({ type:
  // 'location' })` REJECTS `{ latitude, longitude }`, so these assertions used
  // to pin — on both the read and the produce side — a shape the platform's own
  // contract refuses. `geolocation` below is deliberately NOT the same case: it
  // is not a member of the spec's closed `FieldType` union, so it keeps its own
  // `{ latitude, longitude }` value shape.
    it('renders the coordinate pair, never "[Object]"', () => {
      render(
        <InlineFieldInput
          field={{ name: 'site', type: 'location' }}
          value={{ lat: 37.7749, lng: -122.4194 }}
          onChange={vi.fn()}
        />,
      );
      expect(screen.queryByDisplayValue('[Object]')).toBeNull();
      expect(screen.getByDisplayValue('37.7749, -122.4194')).toBeInTheDocument();
    });

    it('emits a STRUCTURED OBJECT on edit', () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput
          field={{ name: 'site', type: 'location' }}
          value={{ lat: 37.7749, lng: -122.4194 }}
          onChange={onChange}
        />,
      );
      fireEvent.change(screen.getByDisplayValue('37.7749, -122.4194'), {
        target: { value: '40.7128, -74.006' },
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0];
      expect(typeof next).toBe('object');
      expect(next).toEqual({ lat: 40.7128, lng: -74.006 });
    });

    it('never emits a bare STRING that replaces the whole object', () => {
      const onChange = vi.fn();
      const { container } = render(
        <InlineFieldInput
          field={{ name: 'site', type: 'location' }}
          value={{ lat: 37.7749, lng: -122.4194 }}
          onChange={onChange}
        />,
      );
      typeIntoFirstBox(container, '40.7128, -74.006');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(typeof onChange.mock.calls[0][0]).not.toBe('string');
      expect(typeof onChange.mock.calls[0][0]).toBe('object');
    });
  });

  describe('geolocation', () => {
    it('renders separate latitude / longitude inputs, never "[Object]"', () => {
      render(
        <InlineFieldInput
          field={{ name: 'checkin', type: 'geolocation' }}
          value={{ latitude: 37.7749, longitude: -122.4194 }}
          onChange={vi.fn()}
        />,
      );
      expect(screen.queryByDisplayValue('[Object]')).toBeNull();
      expect(screen.getByDisplayValue('37.7749')).toBeInTheDocument();
      expect(screen.getByDisplayValue('-122.4194')).toBeInTheDocument();
    });

    it('emits a STRUCTURED OBJECT on edit, preserving the untouched coordinate', () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput
          field={{ name: 'checkin', type: 'geolocation' }}
          value={{ latitude: 37.7749, longitude: -122.4194 }}
          onChange={onChange}
        />,
      );
      fireEvent.change(screen.getByDisplayValue('37.7749'), {
        target: { value: '40.7128' },
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0];
      expect(typeof next).toBe('object');
      expect(next).toEqual({ latitude: 40.7128, longitude: -122.4194 });
    });

    it('never emits a bare STRING that replaces the whole object', () => {
      const onChange = vi.fn();
      const { container } = render(
        <InlineFieldInput
          field={{ name: 'checkin', type: 'geolocation' }}
          value={{ latitude: 37.7749, longitude: -122.4194 }}
          onChange={onChange}
        />,
      );
      typeIntoFirstBox(container, '40.7128');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(typeof onChange.mock.calls[0][0]).not.toBe('string');
      expect(typeof onChange.mock.calls[0][0]).toBe('object');
    });
  });

  /**
   * CONTROLS — the terminal text input is still the right editor for the
   * already-a-string families, and routing the composites above must not
   * disturb them. A `text` field whose value is an unexpanded object is the
   * pre-existing guard (a reference that slipped through type detection) and
   * deliberately keeps its `coerceToSafeValue` behaviour.
   */
  describe('controls — string-valued types keep the terminal text input', () => {
    it('text still edits as one text box emitting a string', () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput
          field={{ name: 'title', type: 'text' }}
          value="Hello"
          onChange={onChange}
        />,
      );
      const input = screen.getByDisplayValue('Hello');
      expect(input).toHaveAttribute('type', 'text');
      fireEvent.change(input, { target: { value: 'Hi there' } });
      expect(onChange).toHaveBeenCalledWith('Hi there');
      expect(typeof onChange.mock.calls[0][0]).toBe('string');
    });

    it('email still edits as one text box emitting a string', () => {
      const onChange = vi.fn();
      render(
        <InlineFieldInput
          field={{ name: 'email', type: 'email' }}
          value="a@b.com"
          onChange={onChange}
        />,
      );
      fireEvent.change(screen.getByDisplayValue('a@b.com'), {
        target: { value: 'c@d.com' },
      });
      expect(onChange).toHaveBeenCalledWith('c@d.com');
    });
  });
});
