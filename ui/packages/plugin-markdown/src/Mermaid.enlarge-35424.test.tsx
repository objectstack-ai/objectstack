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
    // Like mermaid: the render id prefixes the root id, the markers and the
    // references to them. (jsdom drops an svg <style>'s text, so none here.)
    render: async (id: string) => ({
      svg: `<svg id="${id}" data-testid="diagram-svg"><defs><marker id="${id}_arrow"></marker></defs><path marker-end="url(#${id}_arrow)"></path></svg>`,
    }),
  },
}));

import { Mermaid } from './Mermaid';
import { MermaidEnlargeContext } from './MermaidEnlargeContext';

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
    const enlarged = dialog.querySelector('[data-mermaid-enlarged] svg');
    expect(enlarged).not.toBeNull();
    // The dialog's copy has ids of its own: no id appears twice while it is open.
    expect(enlarged?.id).toMatch(/^os-mermaid-\d+-enlarged$/);
    expect(enlarged?.querySelector('marker')?.id).toBe(`${enlarged?.id}_arrow`);
    expect(enlarged?.querySelector('path')?.getAttribute('marker-end')).toBe(`url(#${enlarged?.id}_arrow)`);
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id).filter((v) => v.startsWith('os-mermaid-'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('without a provider the diagram draws no control, as before', async () => {
    render(<Mermaid chart="graph TD; A-->B;" />);
    await screen.findByTestId('diagram-svg');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
