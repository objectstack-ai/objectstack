/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unique sub-input ids for the composite `geolocation` widget
 * (objectui#3343).
 *
 * The widget used to hardcode literal ids ("latitude" / "longitude") on its
 * sub-inputs. Two geolocation fields in one form — e.g. origin + destination
 * — then produced duplicate DOM ids, and every `Label htmlFor` resolved to
 * the FIRST match in the document: each sub-label of the second field
 * clicked/announced the first field's input.
 *
 * The fix follows the `groupId` paradigm of RadioField / CheckboxesField:
 * a `useId()` prefix + the sub-field name. These tests pin it by rendering
 * TWO instances in one form:
 *
 * 1. every `[id]` in the document is globally unique (red again if anyone
 *    reverts to hardcoded literals — both instances would emit
 *    id="latitude");
 * 2. each sub-label of the SECOND instance resolves — via the exact
 *    mechanism browsers use for label activation, `for` → getElementById —
 *    to an input inside its OWN instance, and focusing it lands there.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GeolocationField } from './GeolocationField';

const field = { name: 'location', type: 'geolocation' } as any;

const SUB_LABELS = ['Latitude', 'Longitude'];

function renderTwoInOneForm() {
  return render(
    <form>
      <div data-testid="geo-a">
        <GeolocationField value={{}} onChange={vi.fn()} field={field} />
      </div>
      <div data-testid="geo-b">
        <GeolocationField value={{}} onChange={vi.fn()} field={field} />
      </div>
    </form>,
  );
}

describe('GeolocationField — unique sub-input ids (objectui#3343)', () => {
  it('two geolocation fields in one form produce globally unique DOM ids', () => {
    const { baseElement } = renderTwoInOneForm();
    const ids = Array.from(baseElement.querySelectorAll('[id]')).map((el) => el.id);
    // 2 sub-inputs per instance — both instances must actually render ids.
    expect(ids.length).toBeGreaterThanOrEqual(4);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it("each sub-label of the SECOND field focuses that field's own input", () => {
    const { getByTestId } = renderTwoInOneForm();
    const first = getByTestId('geo-a');
    const second = getByTestId('geo-b');

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
