/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7132 — the empty state must declare what it is.
 *
 * `DataLoadingState` has always been `role="status"` and `DataErrorState`
 * `role="alert"`; `DataEmptyState` alone declared nothing, so "this list is
 * young" and "this list failed to load" were the same node shape. Both the
 * hotcrm#1212 (#7063) and hotcrm#1247 (#7064) rulings name *distinguishable
 * from a load failure* as the first property an empty state owes, and four
 * separate call sites had each hand-typed `role="status"` to get it.
 *
 * SUITE DIRECTION, predicted before running: the DEFAULT arm is red against
 * `origin/main` and green after. The OVERRIDE arms and the two SIBLING arms are
 * green in both worlds — they are the negative controls proving the default is
 * a default (a call site keeps the last word, which is why the two already-ruled
 * surfaces are inert under this change) and that the contrast it is measured
 * against is real.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataEmptyState, DataErrorState, DataLoadingState } from '../custom/view-states';

const emptyBox = (c: HTMLElement) => c.querySelector('[data-slot="data-empty-state"]');

describe('DataEmptyState — role default (#7132)', () => {
  it('DEFAULT: declares role="status" with no call-site prop', () => {
    const { container } = render(<DataEmptyState />);
    const box = emptyBox(container);
    expect(box).not.toBeNull();
    expect(box!.getAttribute('role')).toBe('status');
  });

  it('DEFAULT survives the props a real call site passes alongside it', () => {
    const { container } = render(
      <DataEmptyState title="Nothing here yet" description="Create your first record." />,
    );
    expect(emptyBox(container)!.getAttribute('role')).toBe('status');
    // The default must not have displaced the rest of the render.
    expect(container.textContent).toContain('Nothing here yet');
  });

  // The borrow this arm was written for is gone — `plugin-list`'s load-failure
  // panel moved to `DataErrorState` in objectui#7143 — but the mechanism it
  // measures is the reason the default is safe to have, so it is kept and
  // renamed rather than retired with the call site that motivated it.
  it('OVERRIDE: a call site passing role="alert" keeps it', () => {
    const { container } = render(<DataEmptyState role="alert" title="You don’t have access" />);
    expect(emptyBox(container)!.getAttribute('role')).toBe('alert');
  });

  it('OVERRIDE: the already-ruled surfaces pass role="status" explicitly and are unchanged', () => {
    // plugin-dashboard's WidgetEmptyState (#7063) and plugin-kanban both spell
    // this out. They must receive the identical attribute with or without the
    // default, which is what makes #7132 inert for them.
    const { container } = render(<DataEmptyState role="status" aria-live="polite" />);
    const box = emptyBox(container)!;
    expect(box.getAttribute('role')).toBe('status');
    expect(box.getAttribute('aria-live')).toBe('polite');
  });

  it('SIBLING CONTRAST: the error state is an alert and the loading state a status', () => {
    const { container: err } = render(<DataErrorState />);
    expect(err.querySelector('[data-slot="data-error-state"]')!.getAttribute('role')).toBe('alert');
    const { container: load } = render(<DataLoadingState />);
    expect(load.querySelector('[data-slot="data-loading-state"]')!.getAttribute('role')).toBe('status');
  });
});
