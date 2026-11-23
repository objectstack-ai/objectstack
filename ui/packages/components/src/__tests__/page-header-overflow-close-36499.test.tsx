/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` — a `⋯` entry closes the menu when it finished on the click
 * (objectstack#36499). The record page's 「Configure tabs」 changes the page
 * in place; the menu, kept open, stayed over the page it had just changed. An
 * entry still running (it returned a pending promise) keeps the menu open with
 * its row busy until it settles, as before.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `page:header` at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

function renderHeader(actions: any[]) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider>
        <RecordContextProvider
          objectName="mes_work_order"
          recordId="WO-1"
          data={{ id: 'WO-1', name: 'WO-0001' }}
          objectSchema={{ name: 'mes_work_order', label: 'Work Order' }}
          refresh={vi.fn()}
        >
          <PageHeader schema={{ type: 'page:header', title: 'Work Order', actions }} />
        </RecordContextProvider>
      </ActionProvider>
    </I18nProvider>,
  );
}

async function openMore(): Promise<void> {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
}

afterEach(() => {
  cleanup();
});

describe('page:header — a ⋯ entry that finished on the click closes the menu (objectstack#36499)', () => {
  it('an in-place entry runs once and the menu closes', async () => {
    const enter = vi.fn();
    renderHeader([{ name: 'configure', label: 'Configure tabs', locations: ['record_header'], component: 'action:menu', onClick: enter }]);
    await openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configure tabs' }));
    expect(enter).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('an entry still running keeps the menu open, its row busy, until it settles', async () => {
    let settle: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
    renderHeader([{ name: 'recompute', label: 'Recompute', locations: ['record_header'], component: 'action:menu', onClick: run }]);
    await openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Recompute' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Recompute' })).toHaveAttribute('aria-busy', 'true'));
    await act(async () => settle());
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Recompute' })).not.toHaveAttribute('aria-busy'));
  });
});
