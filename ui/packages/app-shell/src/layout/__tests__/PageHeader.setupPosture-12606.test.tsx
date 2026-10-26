/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12606 — one page header for every Setup page. Inside the Setup app
 * the console page header draws its Setup posture: a 32px icon tile, the title
 * with the kind chip after it, the description on its own line UNDER the
 * title, Refresh as an icon button and the primary action rightmost. Outside
 * Setup the same component keeps objectui#12423's one row.
 *
 * The posture is read off the route's `:appName`, so each case mounts the
 * header under `/apps/:appName/*` and only the segment changes.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PageHeader } from '../PageHeader';

afterEach(cleanup);

function mount(appName: string, onRefresh = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[`/apps/${appName}/page`]}>
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={
            <PageHeader
              title="Users"
              subtitle="Everyone who can sign in."
              icon={<svg data-testid="icon" />}
              badge={<span data-testid="kind-chip">Identity</span>}
              refresh={{ onRefresh, label: 'Refresh' }}
              actions={<button type="button" data-testid="primary-action">New</button>}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { header: screen.getByTestId('page-header'), onRefresh };
}

describe('the console page header’s Setup posture (objectui#12606)', () => {
  it.each(['setup', 'com.objectstack.setup'])(
    'under /apps/%s the description sits under the title, with the kind chip and the primary action',
    (segment) => {
      const { header, onRefresh } = mount(segment);
      expect(header.getAttribute('data-posture')).toBe('setup');

      const h1 = within(header).getByRole('heading', { level: 1 });
      expect(h1.className).toContain('text-lg');
      expect(h1.className).toContain('font-semibold');
      // The kind chip follows the title in the title line.
      const chip = within(header).getByTestId('kind-chip');
      expect(chip.parentElement).toBe(h1.parentElement);

      // The description is its own line under the title line, 13px.
      const description = within(header).getByTestId('page-header-description');
      expect(description.textContent).toBe('Everyone who can sign in.');
      expect(description.className).toContain('text-[13px]');
      expect(description.parentElement).toBe(h1.parentElement!.parentElement);
      expect(description.previousElementSibling).toBe(h1.parentElement);

      // The icon tile is 32px.
      expect(within(header).getByTestId('icon').parentElement!.className).toContain('h-8 w-8');

      // Refresh is an icon button before the primary action, which is last.
      const refresh = within(header).getByTestId('page-header-refresh');
      expect(refresh.getAttribute('aria-label')).toBe('Refresh');
      const primary = within(header).getByTestId('primary-action');
      expect(refresh.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(refresh);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    },
  );

  it('CONTROL — outside Setup the same header keeps the one row', () => {
    const { header } = mount('crm');
    expect(header.getAttribute('data-posture')).toBe('row');
    const h1 = within(header).getByRole('heading', { level: 1 });
    // The description is a sibling of the title in its one row.
    const line = within(header).getByText('Everyone who can sign in.');
    expect(line.parentElement).toBe(h1.parentElement);
    expect(screen.queryByTestId('page-header-description')).toBeNull();
    // The kind chip and the primary action still draw.
    expect(within(header).getByTestId('kind-chip').parentElement).toBe(h1.parentElement);
    expect(within(header).getByTestId('primary-action')).toBeTruthy();
  });

  it('a Setup page with no description keeps the description line, so its title sits where the others do', () => {
    render(
      <MemoryRouter initialEntries={['/apps/setup/page']}>
        <Routes>
          <Route path="/apps/:appName/*" element={<PageHeader title="Bare" />} />
        </Routes>
      </MemoryRouter>,
    );
    const description = screen.getByTestId('page-header-description');
    expect(description.textContent).toBe('');
    expect(description.className).toContain('min-h-[18px]');
  });
});
