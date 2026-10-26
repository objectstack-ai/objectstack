/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app root's "nothing here for you" screen is drawn by the shared
 * `DataEmptyState` (objectstack#25915), so it is announced as
 * `role="status"`. Before, it composed the bare `Empty` primitive around a
 * hand-copied icon square, an unlabelled block to assistive technology.
 *
 * The routing that decides WHEN this screen shows is pinned by the
 * AppContent landing suites; this file pins only what the screen is.
 *
 * The `t` mock returns each call site's `defaultValue`, which the i18n
 * call-site gate holds byte-equal to the `en` pack value.
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
  useObjectLabel: () => ({
    appLabel: (app: { name: string; label?: string }) => app.label ?? app.name,
  }),
}));

import { AppNoAccessEmptyState } from '../AppNoAccessEmptyState';

function renderState(props: Partial<ComponentProps<typeof AppNoAccessEmptyState>> = {}) {
  return render(
    <MemoryRouter>
      <AppNoAccessEmptyState app={{ name: 'crm', label: 'CRM' }} setupPath={null} {...props} />
    </MemoryRouter>,
  );
}

describe('AppNoAccessEmptyState draws the shared empty state (objectstack#25915)', () => {
  it('is a role="status" DataEmptyState inside the test-id wrapper', () => {
    renderState();

    const wrapper = screen.getByTestId('app-no-access-empty-state');
    const status = screen.getByRole('status');
    expect(wrapper).toContainElement(status);
    expect(status).toHaveAttribute('data-slot', 'data-empty-state');
    expect(status).toHaveTextContent('Nothing in {{app}} is available to you yet');
    expect(status).toHaveTextContent('Ask an administrator to grant you access.');
  });

  it.each([
    ['no-navigation', undefined],
    ['no-readable-object', 'no-readable-object' as const],
  ])('carries data-reason=%s on the status node', (expected, reason) => {
    renderState(reason ? { reason } : {});

    expect(screen.getByRole('status')).toHaveAttribute('data-reason', expected);
  });

  it('offers Open Setup as the action only when a setup path is given', () => {
    renderState({ setupPath: '/setup/permissions' });

    const link = screen.getByTestId('app-no-access-open-setup');
    expect(screen.getByRole('status')).toContainElement(link);
    expect(link).toHaveAttribute('href', '/setup/permissions');
  });
});
