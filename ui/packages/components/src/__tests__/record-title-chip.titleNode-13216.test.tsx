/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordTitleChip`'s `titleNode` slot (objectui#13216).
 *
 * `page:header` draws a widget-hinted `nameField` through the field's face, a
 * component that may name the value only after it has read a label, so the H1
 * takes a node. `title` stays a required string for every caller.
 *
 * - The node draws inside the `<h1>`, in place of `title`'s text.
 * - CONTROL: without the node, the `<h1>` draws `title`, as before.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RecordTitleChip } from '../custom/RecordTitleChip';

afterEach(() => cleanup());

describe('RecordTitleChip — the titleNode slot (#13216)', () => {
  it('draws `titleNode` inside the h1, in place of the title text', () => {
    const { container } = render(
      <RecordTitleChip title="usr_9f3" titleNode={<span data-testid="face">Ada Lovelace</span>} />,
    );
    const h1 = container.querySelector('h1');

    expect(h1?.textContent).toBe('Ada Lovelace');
    expect(h1?.querySelector('[data-testid="face"]')).not.toBeNull();
  });

  it('CONTROL — without `titleNode` the h1 draws `title`', () => {
    const { container } = render(<RecordTitleChip title="Acme Corporation" objectLabel="Account" />);

    expect(container.querySelector('h1')?.textContent).toBe('Acme Corporation');
  });
});
