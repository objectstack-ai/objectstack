/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35490 (ADR-0158 R1 display): a `record`-mode quantity in a form
 * shows the unit its record's code field holds, so the number widget is handed
 * the live form record (`dependentValues`), as a record-mode amount is.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import '../../../renderers';
// Paid at collection, not inside a clocked case (check-test-source-alias).
import '@object-ui/react-runtime';

function NumberProbe(props: any) {
  return <div data-testid="number-probe">{JSON.stringify(props.dependentValues ?? null)}</div>;
}

beforeAll(() => {
  ComponentRegistry.register('field:number', NumberProbe, { namespace: 'test' });
}, 30000);

describe('form renderer — a quantity gets the live record (objectstack#35490)', () => {
  it("feeds the number widget the record, so it follows the unit field's edits", async () => {
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [
            { name: 'unit_code', label: 'Unit', type: 'input' },
            { name: 'qty', label: 'Quantity', type: 'number' },
          ],
        }}
      />,
    );
    // The record itself, not `null`: the widget is on the channel before any edit.
    expect(JSON.parse(screen.getByTestId('number-probe').textContent!)).toHaveProperty('unit_code');
    fireEvent.change(screen.getByLabelText(/unit/i), { target: { value: 'GRM' } });
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('number-probe').textContent!)).toMatchObject({ unit_code: 'GRM' });
    });
  });
});
