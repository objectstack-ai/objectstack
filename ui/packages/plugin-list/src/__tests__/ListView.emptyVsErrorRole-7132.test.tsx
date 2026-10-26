/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7132 — a list that is EMPTY and a list that FAILED TO LOAD must not
 * be the same node shape.
 *
 * Measured on `origin/main` by rendering both branches: each one is a
 * `data-slot="data-empty-state"` div with **no `role` at all**. A 403 telling
 * the user "You don't have access" and a young object telling them "Nothing
 * here yet" were structurally indistinguishable — the precise failure the
 * #7063 / #7064 rulings put first, and the reason `ListView` was the
 * "unmeasured" row on #7132's own table.
 *
 * Two things are pinned here because they are separable and either can regress
 * alone: the empty branch takes the platform default (#7132), and the error
 * branch declares `alert` at its own call site so no default can mislabel a
 * failure as a status.
 *
 * ⚠️ Since objectui#7143 the error branch is a `DataErrorState`, not a borrowed
 * `DataEmptyState` — the migration this suite's original prose said had not
 * happened yet. That does NOT retire either arm: `role="alert"` is still typed
 * at the call site rather than inherited, which is what keeps this suite a pin
 * on the CALL SITE and not on whichever primitive it currently draws with.
 * Component identity is pinned separately, in `ListView.errorStateComponent-7143`.
 *
 * SUITE DIRECTION, predicted before running (against #7132's base): the EMPTY
 * arm is red against `origin/main`; the ERROR arm is green in both worlds, and
 * is here as the negative control that keeps a suite collapsed to "no tests"
 * from reading as the fix.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'work_order',
  fields: ['name'],
};

function renderWith(find: () => Promise<unknown>) {
  const ds = {
    find: vi.fn().mockImplementation(find),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ListView schema={schema} dataSource={ds as any} />
    </SchemaRendererProvider>,
  );
}

async function panel(container: HTMLElement, testId: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
  });
  return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
}

describe('ListView — an empty list is not a failed list (#7132)', () => {
  it('EMPTY: the empty state is announced as role="status"', async () => {
    const { container } = renderWith(() => Promise.resolve([]));
    const box = await panel(container, 'empty-state');
    expect(box.getAttribute('role')).toBe('status');
    // Guard against the arm passing over a collapsed render: the empty copy
    // must actually be present in the box being measured.
    expect(box.textContent).toMatch(/nothing here yet/i);
  });

  it('ERROR: the load-failure panel is announced as role="alert"', async () => {
    const { container } = renderWith(() =>
      Promise.reject(Object.assign(new Error('Forbidden'), { httpStatus: 403 })),
    );
    const box = await panel(container, 'list-error-state');
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.getAttribute('data-error-kind')).toBe('forbidden');
  });

  it('the two branches carry DIFFERENT roles, by exact value', async () => {
    const { container: emptyC } = renderWith(() => Promise.resolve([]));
    const emptyRole = (await panel(emptyC, 'empty-state')).getAttribute('role');
    const { container: errC } = renderWith(() =>
      Promise.reject(Object.assign(new Error('Forbidden'), { httpStatus: 403 })),
    );
    const errorRole = (await panel(errC, 'list-error-state')).getAttribute('role');
    // Asserted by exact value, not by inequality: on `origin/main` the roles
    // were `null` and `null`, but a partial fix leaving the empty branch at
    // `null` would still satisfy `null !== 'alert'` and pass a mere-difference
    // assertion. Both values must be named for this arm to be able to fail.
    expect(emptyRole).toBe('status');
    expect(errorRole).toBe('alert');
  });
});
