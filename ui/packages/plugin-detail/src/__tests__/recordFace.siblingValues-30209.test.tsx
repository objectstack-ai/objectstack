/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A record page hands its read faces the record, as a grid cell gets its row
 * (objectstack#30209 row 2).
 *
 * A `recipient-picker` value is an id that means something only beside its
 * sibling `recipient_type`: the console's face reads the sibling from
 * `dependentValues` and names the user, team or position. The list grid
 * passes the row; the highlights strip and the details body passed nothing,
 * so a sharing rule's page read "接收方 zlom5o5m8Oy…" where its list read the
 * user's name.
 *
 * The probe face below is registered under the widget's own key and draws
 * the sibling it received, so the assertion reads what reached the face, not
 * the console's label directory. Red before the fix (the probe drew the
 * "no siblings" marker), green after.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import * as React from 'react';
import { registerFieldRenderer, TextCellRenderer, type CellRendererProps } from '@object-ui/fields';
import type { DetailViewSection, HighlightField } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';

function ProbeFace({ value, dependentValues }: CellRendererProps) {
  const kind = dependentValues?.recipient_type;
  return <span data-testid="probe">{typeof kind === 'string' ? `${kind}:${String(value)}` : 'no-siblings'}</span>;
}

const objectSchema = {
  name: 'sys_sharing_rule',
  fields: {
    recipient_type: { name: 'recipient_type', type: 'select', options: [{ value: 'user', label: 'User' }] },
    recipient_id: { name: 'recipient_id', type: 'text', label: 'Recipient', widget: 'recipient-picker' },
  },
};
const data = { id: 'r1', recipient_type: 'user', recipient_id: 'u_lin' };

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  registerFieldRenderer('recipient-picker', ProbeFace);
});
afterAll(() => {
  // The key's default face, as `@object-ui/fields` registers it.
  registerFieldRenderer('recipient-picker', TextCellRenderer);
});
afterEach(cleanup);

describe('a record page hands its read faces the record (objectstack#30209)', () => {
  it('the highlights strip passes the record to a sibling-scoped face', () => {
    render(
      <HeaderHighlight
        fields={[{ name: 'recipient_id', label: 'Recipient' }] satisfies HighlightField[]}
        data={data}
        objectSchema={objectSchema}
      />,
    );
    expect(screen.getByTestId('probe').textContent).toBe('user:u_lin');
  });

  it('the details body passes the record to a sibling-scoped face', () => {
    const section = { title: 'S', fields: [{ name: 'recipient_id', label: 'Recipient' }] } as unknown as DetailViewSection;
    const { container } = render(<DetailSection section={section} data={data} objectSchema={objectSchema} />);
    expect(within(container).getByTestId('probe').textContent).toBe('user:u_lin');
  });
});
