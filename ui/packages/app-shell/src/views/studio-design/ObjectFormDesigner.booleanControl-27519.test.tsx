// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27519 — the form designer's control preview draws the boolean
 * face the runtime form draws.
 *
 * The defect: `FieldControlPreview` was a hand-written switch on the raw type.
 * A field authored as Checkbox (`boolean`) drew the switch pill, and a Toggle
 * (`toggle`) fell to the empty text box. The preview now reads
 * `resolveBooleanControl`, the same answer `BooleanField` reads in the record
 * form, so the case below compares the card with that function rather than
 * restating the table.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { resolveBooleanControl } from '@object-ui/fields';
import { ObjectFormDesigner } from './ObjectFormDesigner';

afterEach(cleanup);

const FIELDS = [
  { name: 'urgent', type: 'boolean', label: 'Urgent' },
  { name: 'notify', type: 'toggle', label: 'Notify' },
];

function cardControl(label: string): string | null {
  const card = screen.getByText(label).closest('[aria-roledescription], [role="button"], div.flex-col');
  return card?.querySelector('[data-boolean-control]')?.getAttribute('data-boolean-control') ?? null;
}

describe('the canvas previews a boolean field with the runtime form\'s face (objectstack#27519)', () => {
  it('Checkbox (`boolean`) previews a checkbox and Toggle (`toggle`) a switch', () => {
    render(
      <ObjectFormDesigner
        draft={{ name: 'work_order', fields: FIELDS }}
        systemFieldNames={new Set()}
        onChange={() => {}}
        onSelectField={() => {}}
      />,
    );

    expect(cardControl('Urgent')).toBe('checkbox');
    expect(cardControl('Notify')).toBe('switch');
    // The same answer the record form's widget reads, not a canvas copy.
    expect(cardControl('Urgent')).toBe(resolveBooleanControl({ type: 'boolean' }));
    expect(cardControl('Notify')).toBe(resolveBooleanControl({ type: 'toggle' }));
  });
});
