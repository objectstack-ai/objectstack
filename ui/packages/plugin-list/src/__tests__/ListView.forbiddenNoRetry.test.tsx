/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A permission refusal (403) on a list read offers no Retry: the grant is one
 * only an administrator can give, so a retry re-reaches the same refusal. A
 * transient failure (5xx, network) keeps the Retry.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'invoice',
  fields: ['name'],
};

function renderFailing(error: unknown) {
  const ds = {
    find: vi.fn().mockRejectedValue(error),
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

async function errorState(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector('[data-testid="list-error-state"]')).not.toBeNull();
  });
  return container.querySelector('[data-testid="list-error-state"]') as HTMLElement;
}

describe('ListView — a permission refusal offers no Retry', () => {
  it('a 403 draws the no-access panel without Retry', async () => {
    const err = Object.assign(new Error('Forbidden'), { httpStatus: 403, code: 'PERMISSION_DENIED' });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('forbidden');
    expect(panel.querySelector('[data-testid="list-error-retry"]')).toBeNull();
    // "No Retry" is not reached by drawing nothing: the panel still says why.
    expect(panel.textContent).toMatch(/permission/i);
  });

  it('CONTROL: a 500 still draws Retry', async () => {
    const err = Object.assign(new Error('Internal error'), { httpStatus: 500 });
    const { container } = renderFailing(err);
    const panel = await errorState(container);
    expect(panel.getAttribute('data-error-kind')).toBe('network');
    expect(panel.querySelector('[data-testid="list-error-retry"]')).not.toBeNull();
  });

  it('CONTROL: a network failure still draws Retry', async () => {
    const { container } = renderFailing(new TypeError('Failed to fetch'));
    const panel = await errorState(container);
    expect(panel.querySelector('[data-testid="list-error-retry"]')).not.toBeNull();
  });
});
