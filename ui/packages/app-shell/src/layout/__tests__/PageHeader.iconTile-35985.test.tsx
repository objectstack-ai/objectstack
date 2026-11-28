/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35985 — a page that names an object leads with the object's
 * tile (`iconTile`), drawn as given in every posture: no accent chip around it
 * and no icon slot forcing its glyph size, and in place of `icon`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ObjectIconTile } from '@object-ui/components';
import { PageHeader } from '../PageHeader';

// The row and list postures come from the `posture` prop; Setup's is read off
// the route (`/apps/setup/...`), so that case mounts the header under it.
const postures = [
  { reached: 'row', posture: undefined, app: 'crm' },
  { reached: 'list', posture: 'list', app: 'crm' },
  { reached: 'setup', posture: undefined, app: 'setup' },
] as const;

describe('PageHeader draws an object tile as given (objectstack#35985)', () => {
  it.each(postures)('posture $reached: the tile sits directly in the title row, and `icon` is not drawn', ({ reached, posture, app }) => {
    const { container } = render(
      <MemoryRouter initialEntries={[`/apps/${app}/x`]}>
        <Routes>
          <Route
            path="/apps/:appName/*"
            element={
              <PageHeader
                title="Accounts"
                posture={posture}
                icon={<svg data-testid="line-icon" />}
                iconTile={<ObjectIconTile icon="building" color="orange" />}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-posture]')).toHaveAttribute('data-posture', reached);
    const tile = document.querySelector('[data-object-icon-tile]') as HTMLElement;
    expect(tile).toHaveAttribute('data-object-icon-tile', 'orange');
    expect(screen.queryByTestId('line-icon')).toBeNull();
    // Not wrapped: no list icon slot, no accent chip with an inline style.
    expect(screen.queryByTestId('page-header-icon')).toBeNull();
    expect(tile.parentElement!.getAttribute('style')).toBeNull();
    expect(tile.parentElement!.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
  });

  it('CONTROL: without `iconTile` the line icon still draws in its slot', () => {
    render(<PageHeader title="Accounts" posture="list" icon={<svg data-testid="line-icon" />} />);
    expect(screen.getByTestId('page-header-icon')).toContainElement(screen.getByTestId('line-icon'));
  });
});
