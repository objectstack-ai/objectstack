/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35678 — the list-page scope is counted per page column. The page
 * header and the view bar's trailing end both register the same column, and
 * one unmounts as the other mounts; the column stays a list page until its
 * LAST registrant goes, whatever order React runs their effects in.
 */
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { useListPageScope, useIsListPageGrid } from '../listPageScope';

afterEach(cleanup);

const Registrant: React.FC<{ scope: HTMLElement }> = ({ scope }) => {
  useListPageScope(scope);
  return null;
};

const Probe: React.FC<{ root: HTMLElement }> = ({ root }) => (
  <span data-testid="probe">{useIsListPageGrid(root) ? 'list page' : 'elsewhere'}</span>
);

function column(): { scope: HTMLElement; grid: HTMLElement } {
  const scope = document.createElement('div');
  const grid = document.createElement('div');
  scope.appendChild(grid);
  document.body.appendChild(scope);
  return { scope, grid };
}

describe('useListPageScope (objectstack#35678)', () => {
  it('two registrants of one column: unmounting one keeps the scope; unmounting both drops it', () => {
    const { scope, grid } = column();
    const view = (a: boolean, b: boolean) => (
      <>
        {a && <Registrant key="header" scope={scope} />}
        {b && <Registrant key="trailing" scope={scope} />}
        <Probe root={grid} />
      </>
    );
    const { rerender } = render(view(true, false));
    expect(screen.getByTestId('probe')).toHaveTextContent('list page');
    // The trailing end registers first, then the header goes, in the order
    // that dropped the scope while it was a plain set.
    rerender(view(true, true));
    rerender(view(false, true));
    expect(screen.getByTestId('probe')).toHaveTextContent('list page');
    rerender(view(false, false));
    expect(screen.getByTestId('probe')).toHaveTextContent('elsewhere');
    scope.remove();
  });

  it('CONTROL: a grid outside every registered column is not a list page', () => {
    const { scope } = column();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    render(
      <>
        <Registrant scope={scope} />
        <Probe root={outside} />
      </>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('elsewhere');
    scope.remove();
    outside.remove();
  });
});
