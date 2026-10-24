/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7143 — the load-failure panel is rendered by `DataErrorState`.
 *
 * `ListView` drew its load FAILURE with `DataEmptyState`, the component named
 * for the *empty* case, passing it a destructive icon, error copy and a retry
 * control — while `DataErrorState`, in the same file with the same layout and
 * `role="alert"` already declared, had no consumer anywhere in the repo. The
 * maintainer ruling of 2026-09-01 approved the migration and excluded the
 * alternative (a comment recording that one component does the other's job).
 *
 * WHAT IS PINNED HERE, and why each half can regress alone:
 *
 *  1. COMPONENT IDENTITY — the panel's `data-slot` is `data-error-state`. This
 *     is the whole of the rendered delta and the only arm red on `origin/main`.
 *  2. EVERYTHING ELSE IS UNCHANGED — `role="alert"`, `data-testid`,
 *     `data-error-kind`, the per-kind glyph, the stripped icon wrapper, the copy
 *     and the retry button all survive the swap. These arms are green in both
 *     worlds on purpose: a migration that "passes" by dropping the panel's
 *     affordances is the failure mode a bare identity assertion cannot see.
 *  3. THE CONTROL — the genuine empty branch is STILL `DataEmptyState` with
 *     `role="status"`. Without it, a change that swapped both panels (or the
 *     wrong one) reads as a pass.
 *
 * SUITE DIRECTION, MEASURED by reverting both source files to the base commit
 * and re-running: RED against `origin/main` are the two arms that read the
 * panel's `data-slot` (it is `data-empty-state` there) and the glyph arm, which
 * selects the icon wrapper by a `data-slot` that only exists after this change.
 * GREEN in both worlds are the role/test-id arm, the retry arm, and the
 * empty-branch control — the affordances a migration must carry over, which a
 * bare identity assertion cannot see going missing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'account',
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

const failing = (error: unknown) => renderWith(() => Promise.reject(error));
const forbidden = () => Object.assign(new Error('Forbidden'), { httpStatus: 403 });

async function panel(container: HTMLElement, testId: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
  });
  return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
}

describe('ListView — the load failure is a DataErrorState (#7143)', () => {
  it('IDENTITY: the panel is data-slot="data-error-state"', async () => {
    const { container } = failing(forbidden());
    const box = await panel(container, 'list-error-state');
    expect(box.getAttribute('data-slot')).toBe('data-error-state');
    // Named in both directions: the component it used to borrow must be gone
    // from this node, not merely joined by a second slot value.
    expect(box.getAttribute('data-slot')).not.toBe('data-empty-state');
  });

  it('UNCHANGED: role, test id and error kind survive the swap', async () => {
    const { container } = failing(forbidden());
    const box = await panel(container, 'list-error-state');
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.getAttribute('data-error-kind')).toBe('forbidden');
    expect(box.textContent).toMatch(/permission|access/i);
  });

  it('UNCHANGED: the per-kind glyph still reaches the panel, in a stripped wrapper', async () => {
    // The reason `DataErrorState` needed props at all: this panel draws an
    // outage differently from a denial, and it removes the primitive's box.
    const { container } = failing(new TypeError('Failed to fetch'));
    const box = await panel(container, 'list-error-state');
    const icon = box.querySelector('[data-slot="data-error-state-icon"]');
    expect(icon).not.toBeNull();
    expect(icon!.querySelector('svg')).not.toBeNull();
    // `iconWrapperClassName` REPLACES rather than merges, so the destructive
    // square the primitive draws by default must not have survived.
    expect(icon!.className).toBe('mb-3');
  });

  it('UNCHANGED: the retry button is still rendered inside the panel', async () => {
    const { container } = failing(forbidden());
    const box = await panel(container, 'list-error-state');
    const retry = box.querySelector('[data-testid="list-error-retry"]');
    expect(retry).not.toBeNull();
    expect(retry!.textContent).toMatch(/retry/i);
  });

  it('UNCHANGED: an enable-block denial still offers no retry', async () => {
    const err = Object.assign(new Error('Object API is disabled'), {
      httpStatus: 404,
      code: 'OBJECT_API_DISABLED',
    });
    const { container } = failing(err);
    const box = await panel(container, 'list-error-state');
    expect(box.querySelector('[data-testid="list-error-retry"]')).toBeNull();
    // The panel itself is still there — "no retry" must not be reached by
    // rendering nothing at all.
    expect(box.getAttribute('data-slot')).toBe('data-error-state');
  });

  it('CONTROL: the genuine empty branch is still a DataEmptyState with role="status"', async () => {
    const { container } = renderWith(() => Promise.resolve([]));
    const box = await panel(container, 'empty-state');
    expect(box.getAttribute('data-slot')).toBe('data-empty-state');
    expect(box.getAttribute('role')).toBe('status');
  });
});
