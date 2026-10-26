/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unique sub-input ids for the composite `address` widget (objectui#3343).
 *
 * The widget used to hardcode literal ids ("street", "city", "state",
 * "postalCode" — spelled "zipCode" until objectstack#5143 —, "country") on its
 * sub-inputs. Two address fields in one form —
 * e.g. billing + shipping — then produced duplicate DOM ids, and every
 * `Label htmlFor` resolved to the FIRST match in the document: each sub-label
 * of the second field clicked/announced the first field's input.
 *
 * The fix follows the `groupId` paradigm of RadioField / CheckboxesField:
 * a `useId()` prefix + the sub-field name. These tests pin it by rendering
 * TWO instances in one form:
 *
 * 1. every `[id]` in the document is globally unique (red again if anyone
 *    reverts to hardcoded literals — both instances would emit id="street");
 * 2. each sub-label of the SECOND instance resolves — via the exact
 *    mechanism browsers use for label activation, `for` → getElementById —
 *    to an input inside its OWN instance, and focusing it lands there.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AddressField } from './AddressField';

const field = { name: 'address', type: 'address' } as any;

const SUB_LABELS = [
  'Street Address',
  'City',
  'State / Province',
  'ZIP / Postal Code',
  'Country',
];

function renderTwoInOneForm() {
  return render(
    <form>
      <div data-testid="address-a">
        <AddressField value={{}} onChange={vi.fn()} field={field} />
      </div>
      <div data-testid="address-b">
        <AddressField value={{}} onChange={vi.fn()} field={field} />
      </div>
    </form>,
  );
}

describe('AddressField — unique sub-input ids (objectui#3343)', () => {
  it('two address fields in one form produce globally unique DOM ids', () => {
    const { baseElement } = renderTwoInOneForm();
    const ids = Array.from(baseElement.querySelectorAll('[id]')).map((el) => el.id);
    // 5 sub-inputs per instance — both instances must actually render ids.
    expect(ids.length).toBeGreaterThanOrEqual(10);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it("each sub-label of the SECOND field focuses that field's own input", () => {
    const { getByTestId } = renderTwoInOneForm();
    const first = getByTestId('address-a');
    const second = getByTestId('address-b');

    for (const text of SUB_LABELS) {
      const label = within(second).getByText(text);
      const forId = label.getAttribute('for');
      expect(forId, `label "${text}" must carry htmlFor`).toBeTruthy();

      // Exactly what the browser does on label click / SR announcement:
      // resolve `for` against the document.
      const control = document.getElementById(forId!);
      expect(control, `htmlFor of "${text}" must resolve`).not.toBeNull();
      expect(control!.tagName).toBe('INPUT');
      expect(
        second.contains(control),
        `"${text}" must resolve into its OWN field, not the first one`,
      ).toBe(true);
      expect(first.contains(control)).toBe(false);

      (control as HTMLInputElement).focus();
      expect(control).toHaveFocus();
    }
  });
});
