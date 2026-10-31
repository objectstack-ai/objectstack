/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27058, Target 7 — a record's header on a phone draws no action
 * row: its actions go to the host's bottom bar (`PageHeaderPhoneContext`), in
 * the row's bar face, through the same `PageHeaderActions` resolver.
 *
 *  - the bar holds the primary action, one more and the `⋯`;
 *  - the host's Edit is one of the record's actions there: it takes the
 *    second slot when the page declares one action, and folds into the `⋯`
 *    when a declared second action fills the bar;
 *  - `mobileMaxVisible` still sets the bar's budget when the page declares it;
 *  - nothing is drawn until the host's bar element exists;
 *  - the host's subtitle stands in for an undeclared one, and an authored
 *    subtitle wins;
 *  - control: without the context the header's row is drawn exactly as
 *    before, the host's Edit inline beside the authored actions.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { PageHeaderPhoneContext, type PageHeaderPhoneFace } from '../index';

function PageHeader({ schema }: { schema: unknown }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const HOST_ACTIONS = [
  { name: 'sys_edit', label: 'Edit' },
  { name: 'sys_delete', label: 'Delete' },
];

const convert = { name: 'convert', locations: ['record_header'], label: 'Convert Lead', type: 'flow' };
const assign = { name: 'assign', locations: ['record_header'], label: 'Assign', type: 'flow' };
const ret = { name: 'return_to_pool', locations: ['record_header'], label: 'Return', type: 'flow' };

/** A host that owns a bottom bar and hands it to the header, as the console's record page does. */
function PhoneHost({ schema, subtitle, mountBar = true }: { schema: unknown; subtitle?: string; mountBar?: boolean }) {
  const [bar, setBar] = React.useState<HTMLDivElement | null>(null);
  const face = React.useMemo<PageHeaderPhoneFace>(() => ({ actionBar: bar, subtitle }), [bar, subtitle]);
  return (
    <ActionProvider>
      <RecordContextProvider
        objectName="lead"
        recordId="1"
        data={{ id: '1', name: 'Mira Costa' }}
        objectSchema={{ name: 'lead', label: 'Lead' }}
        headerSystemActions={HOST_ACTIONS}
      >
        <PageHeaderPhoneContext.Provider value={face}>
          <div data-testid="body">
            <PageHeader schema={schema} />
          </div>
        </PageHeaderPhoneContext.Provider>
      </RecordContextProvider>
      {mountBar && <div ref={setBar} data-testid="bar" />}
    </ActionProvider>
  );
}

function DesktopHost({ schema }: { schema: unknown }) {
  return (
    <ActionProvider>
      <RecordContextProvider
        objectName="lead"
        recordId="1"
        data={{ id: '1', name: 'Mira Costa' }}
        objectSchema={{ name: 'lead', label: 'Lead' }}
        headerSystemActions={HOST_ACTIONS}
      >
        <PageHeader schema={schema} />
      </RecordContextProvider>
    </ActionProvider>
  );
}

const bar = () => screen.getByTestId('bar');
const barButtons = () =>
  Array.from(bar().querySelectorAll('[role="toolbar"] > button, [role="toolbar"] > [data-disabled-reason] > button'))
    .map((b) => b.getAttribute('aria-label') || b.textContent);

async function openMore(scope: HTMLElement): Promise<string[]> {
  const trigger = within(scope).getByRole('button', { name: /More actions/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  return within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a record header on a phone draws its actions into the host\'s bottom bar (objectstack#27058)', () => {
  it('one declared action: the bar is [Convert Lead][Edit][⋯], and the header draws no action row', async () => {
    render(<PhoneHost schema={{ type: 'page:header', actions: [convert] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    const toolbar = bar().querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('bar');
    expect(barButtons()).toEqual(['Convert Lead', 'Edit', 'More actions']);
    // The primary leads the bar and is the one filled button; the bar's
    // buttons share its width.
    const primary = within(bar()).getByRole('button', { name: 'Convert Lead' });
    expect(primary.className).toContain('flex-1');
    expect(within(screen.getByTestId('body')).queryByRole('toolbar')).toBeNull();
    // The host's Delete is in the `⋯`, as on any width.
    expect(await openMore(bar())).toContain('Delete');
  });

  it('a declared second action takes the second slot, and the host\'s Edit folds into the ⋯', async () => {
    render(<PhoneHost schema={{ type: 'page:header', actions: [convert, assign, ret] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Convert Lead', 'Assign', 'More actions']);
    const items = await openMore(bar());
    // The page's own folded action first, then the host's Edit, then the
    // destructive band.
    expect(items.indexOf('Return')).toBeGreaterThanOrEqual(0);
    expect(items.indexOf('Edit')).toBeGreaterThan(items.indexOf('Return'));
    expect(items.indexOf('Delete')).toBeGreaterThan(items.indexOf('Edit'));
  });

  it('the page\'s declared mobileMaxVisible still sets the bar\'s budget', async () => {
    render(<PhoneHost schema={{ type: 'page:header', mobileMaxVisible: 1, actions: [convert, assign] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Convert Lead', 'More actions']);
    const items = await openMore(bar());
    expect(items).toEqual(expect.arrayContaining(['Assign', 'Edit', 'Delete']));
  });

  it('nothing is drawn until the host\'s bar element exists', () => {
    render(<PhoneHost schema={{ type: 'page:header', actions: [convert] }} mountBar={false} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Convert Lead' })).toBeNull();
    // The header itself still draws: the record's name is there.
    expect(screen.getByRole('heading', { name: /Mira Costa/ })).toBeTruthy();
  });

  it('the host\'s subtitle stands in for an undeclared one; an authored subtitle wins', async () => {
    render(<PhoneHost schema={{ type: 'page:header', actions: [convert] }} subtitle="Atlas Construction · Director of Sales" />);
    const line = await waitFor(() => {
      const el = document.querySelector('[data-page-header-subtitle="host"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(line.textContent).toBe('Atlas Construction · Director of Sales');
    expect(line.className).toContain('truncate');
    cleanup();

    render(
      <PhoneHost
        schema={{ type: 'page:header', subtitle: 'Hot lead from the expo', actions: [convert] }}
        subtitle="Atlas Construction · Director of Sales"
      />,
    );
    await screen.findByText('Hot lead from the expo');
    expect(document.querySelector('[data-page-header-subtitle="host"]')).toBeNull();
    expect(screen.queryByText('Atlas Construction · Director of Sales')).toBeNull();
  });

  it('control: without the phone context the header\'s own row draws, Edit inline beside the authored actions', () => {
    render(<DesktopHost schema={{ type: 'page:header', actions: [convert, assign] }} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('row');
    expect(within(toolbar).getByRole('button', { name: 'Convert Lead' })).toBeTruthy();
    expect(within(toolbar).getByRole('button', { name: 'Assign' })).toBeTruthy();
    expect(within(toolbar).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(document.querySelector('[data-page-header-subtitle]')).toBeNull();
  });
});
