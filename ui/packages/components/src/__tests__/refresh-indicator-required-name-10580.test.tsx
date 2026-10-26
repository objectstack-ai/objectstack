/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RefreshIndicator` names its progress bar only with what the caller passes
 * (objectui#10580).
 *
 * `ariaLabel` used to be optional with the English default "Refreshing", so
 * four data views that passed nothing announced English to every non-English
 * screen-reader user. The prop is now required and the default is gone: a
 * caller that names nothing is a compile error, not an English name.
 *
 * Two halves:
 *   - TYPE: erased at runtime, so vitest proves nothing about it. It is
 *     checked by `tsc -p tsconfig.test.json`, which this package's
 *     `type-check` script chains.
 *   - DOM: the rendered bar carries exactly the passed name, and a caller that
 *     slips past the type (a cast) gets no English name either.
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { RefreshIndicator, type RefreshIndicatorProps } from '../custom/refresh-indicator';

describe('RefreshIndicator takes its accessible name from the caller (objectui#10580)', () => {
  it('a caller that passes no name does not compile', () => {
    // Built, never rendered: these two elements are here for `tsc` to judge.
    const accepted = <RefreshIndicator active ariaLabel="Actualizando…" />;
    const refused = (
      // @ts-expect-error `ariaLabel` is required — with an optional prop this directive goes unused (TS2578)
      <RefreshIndicator active />
    );
    expect(React.isValidElement(accepted) && React.isValidElement(refused)).toBe(true);
  });

  it('names the progress bar with the passed string', () => {
    render(<RefreshIndicator active ariaLabel="Wird aktualisiert…" />);
    const bar = screen.getByRole('progressbar', { name: 'Wird aktualisiert…' });
    expect(bar.getAttribute('aria-busy')).toBe('true');
  });

  it('renders nothing while inactive', () => {
    render(<RefreshIndicator active={false} ariaLabel="Wird aktualisiert…" />);
    expect(screen.queryByTestId('refresh-indicator')).toBeNull();
  });

  it('has no English name to fall back to when a caller casts past the type', () => {
    const props = { active: true } as unknown as RefreshIndicatorProps;
    render(<RefreshIndicator {...props} />);
    const bar = screen.getByTestId('refresh-indicator');
    expect(bar.hasAttribute('aria-label')).toBe(false);
  });
});
