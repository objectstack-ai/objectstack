/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35424 — a diagram opens full size where the host asks for it
 * (`MermaidEnlargeContext`, provided by the docs reader), and draws no control
 * anywhere else.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';

vi.mock('mermaid', () => ({
  default: {
    initialize: () => undefined,
    render: async () => ({ svg: '<svg data-testid="diagram-svg"><g></g></svg>' }),
  },
}));

import { Mermaid, MermaidEnlargeContext } from './Mermaid';

afterEach(cleanup);

const TEXT = { enlarge: 'Enlarge', title: 'Diagram' };

describe('Mermaid — the enlarge control (objectstack#35424)', () => {
  it('with the host\'s words, the drawn diagram carries an enlarge button that opens it full size', async () => {
    render(
      <MermaidEnlargeContext.Provider value={TEXT}>
        <Mermaid chart="graph TD; A-->B;" />
      </MermaidEnlargeContext.Provider>,
    );
    const button = await screen.findByRole('button', { name: 'Enlarge' });
    expect(screen.getAllByTestId('diagram-svg')).toHaveLength(1);
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Diagram' });
    expect(dialog.querySelector('[data-mermaid-enlarged] svg')).not.toBeNull();
  });

  it('without a provider the diagram draws no control, as before', async () => {
    render(<Mermaid chart="graph TD; A-->B;" />);
    await screen.findByTestId('diagram-svg');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
