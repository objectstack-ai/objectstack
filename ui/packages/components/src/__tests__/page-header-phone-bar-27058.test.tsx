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
 *  - the bar holds two buttons and the `⋯`;
 *  - the host's Edit takes the first slot and the primary action the second,
 *    whatever the page declares; the page's other actions fold into the `⋯`
 *    (objectstack#34595 — the order this file pinned before put Edit after
 *    the page's actions, so a declared second action pushed it into the `⋯`);
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
// `react-page.tsx` (reached through `../index`) loads this dynamically; paying
// its transform here keeps it out of any test's clocked window.
import '@object-ui/react-runtime';

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
function PhoneHost({
  schema,
  subtitle,
  mountBar = true,
  hostActions = HOST_ACTIONS,
}: { schema: unknown; subtitle?: string; mountBar?: boolean; hostActions?: unknown[] }) {
  const [bar, setBar] = React.useState<HTMLDivElement | null>(null);
  const face = React.useMemo<PageHeaderPhoneFace>(() => ({ actionBar: bar, subtitle }), [bar, subtitle]);
  return (
    <ActionProvider>
      <RecordContextProvider
        objectName="lead"
        recordId="1"
        data={{ id: '1', name: 'Mira Costa' }}
        objectSchema={{ name: 'lead', label: 'Lead' }}
        headerSystemActions={hostActions}
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

function DesktopHost({ schema, hostActions = HOST_ACTIONS }: { schema: unknown; hostActions?: unknown[] }) {
  return (
    <ActionProvider>
      <RecordContextProvider
        objectName="lead"
        recordId="1"
        data={{ id: '1', name: 'Mira Costa' }}
        objectSchema={{ name: 'lead', label: 'Lead' }}
        headerSystemActions={hostActions}
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
  it('one declared action: the bar is [Edit][Convert Lead][⋯], and the header draws no action row (objectstack#34595)', async () => {
    render(<PhoneHost schema={{ type: 'page:header', actions: [convert] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    const toolbar = bar().querySelector('[role="toolbar"]')!;
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('bar');
    expect(barButtons()).toEqual(['Edit', 'Convert Lead', 'More actions']);
    // Edit leads the bar (objectstack#34595), the primary follows; the bar's
    // buttons share its width.
    const primary = within(bar()).getByRole('button', { name: 'Convert Lead' });
    expect(primary.className).toContain('flex-1');
    expect(within(screen.getByTestId('body')).queryByRole('toolbar')).toBeNull();
    // The host's Delete is in the `⋯`, as on any width.
    expect(await openMore(bar())).toContain('Delete');
  });

  it('declared second and third actions fold into the ⋯; the host\'s Edit keeps its slot (objectstack#34595)', async () => {
    render(<PhoneHost schema={{ type: 'page:header', actions: [convert, assign, ret] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Edit', 'Convert Lead', 'More actions']);
    const items = await openMore(bar());
    // The page's own folded actions first, then the destructive band; Edit
    // is not in the `⋯`.
    expect(items.indexOf('Assign')).toBeGreaterThanOrEqual(0);
    expect(items.indexOf('Return')).toBeGreaterThan(items.indexOf('Assign'));
    expect(items).not.toContain('Edit');
    expect(items.indexOf('Delete')).toBeGreaterThan(items.indexOf('Return'));
  });

  it('the page\'s declared mobileMaxVisible still sets the bar\'s budget', async () => {
    render(<PhoneHost schema={{ type: 'page:header', mobileMaxVisible: 1, actions: [convert, assign] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    // A budget of one is Edit's (objectstack#34595); the primary folds.
    expect(barButtons()).toEqual(['Edit', 'More actions']);
    const items = await openMore(bar());
    expect(items).toEqual(expect.arrayContaining(['Convert Lead', 'Assign', 'Delete']));
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

/**
 * objectstack#34595 — on an editable record the phone bar keeps Edit visible.
 * Measured on an opportunity at 375 px: the page's own actions ("Generate
 * Quote", "Clone Opportunity") filled both slots and Edit was the fifth entry
 * of the `⋯`. The bar is now Edit, the primary action, then the `⋯`.
 */
describe('the phone bar keeps Edit visible on an editable record (objectstack#34595)', () => {
  const clone = { name: 'clone_opportunity', locations: ['record_header'], label: 'Clone Opportunity', type: 'flow' };
  // Declared second, so the primary is picked by its `variant`, not by position.
  const quote = { name: 'generate_quote', locations: ['record_header'], label: 'Generate Quote', type: 'flow', variant: 'primary' };
  const report = { name: 'print_report', locations: ['record_header'], label: 'Print', type: 'flow' };
  const OPPORTUNITY = { type: 'page:header', actions: [clone, quote, report] };

  it('draws [Edit][primary][⋯]: the primary is the action declaring variant primary, the rest fold', async () => {
    render(<PhoneHost schema={OPPORTUNITY} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Edit', 'Generate Quote', 'More actions']);
    // One filled button, and it is the primary — not Edit.
    expect(within(bar()).getByRole('button', { name: 'Generate Quote' }).className).toContain('bg-primary');
    expect(within(bar()).getByRole('button', { name: 'Edit' }).className).not.toContain('bg-primary');
    const items = await openMore(bar());
    expect(items).toEqual(expect.arrayContaining(['Clone Opportunity', 'Print', 'Delete']));
    expect(items).not.toContain('Edit');
    // The destructive host action still opens the destructive band last.
    expect(items[items.length - 1]).toBe('Delete');
  });

  it('a larger mobileMaxVisible draws the next of the page\'s actions after Edit and the primary', async () => {
    render(<PhoneHost schema={{ ...OPPORTUNITY, mobileMaxVisible: 3 }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Edit', 'Generate Quote', 'Clone Opportunity', 'More actions']);
  });

  it('a record the reader cannot edit (no host Edit) keeps the primary and one more', async () => {
    render(<PhoneHost schema={OPPORTUNITY} hostActions={[{ name: 'sys_delete', label: 'Delete' }]} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Generate Quote', 'Clone Opportunity', 'More actions']);
    expect(await openMore(bar())).toEqual(['Print', 'Delete']);
  });

  it('with no page action the bar is Edit alone and the filled button, as before', async () => {
    render(<PhoneHost schema={{ type: 'page:header', actions: [] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Edit', 'More actions']);
    expect(within(bar()).getByRole('button', { name: 'Edit' }).className).toContain('bg-primary');
  });

  it('control: the desktop row is unchanged — the page\'s actions inline, primary first, Edit after them', () => {
    render(<DesktopHost schema={OPPORTUNITY} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.getAttribute('data-page-header-actions-face')).toBe('row');
    const labels = within(toolbar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') || b.textContent);
    expect(labels).toEqual(['Generate Quote', 'Clone Opportunity', 'Print', 'Edit', 'More actions']);
  });
});

/**
 * objectstack#36151 — a phone host that hands a top-bar slot for the `⋯`
 * (`PageHeaderPhoneContext.more`): the bottom bar holds the action buttons
 * alone, filling the row, and the `⋯` is drawn in the slot; with no button to
 * draw the bar is left empty. The console's record page hands its Edit as a
 * menu entry there (`component: 'action:menu'`), so it is one of the `⋯`'s
 * entries. Control: without the slot (every test above) the `⋯` stays the
 * bar's last button.
 */
describe('the phone bar with the host\'s top-bar ⋯ slot (objectstack#36151)', () => {
  const MENU_EDIT = [
    { name: 'sys_edit', label: 'Edit', component: 'action:menu' },
    { name: 'sys_delete', label: 'Delete' },
  ];

  function TopBarHost({ schema, mountMore = true }: { schema: unknown; mountMore?: boolean }) {
    const [barEl, setBarEl] = React.useState<HTMLDivElement | null>(null);
    const [moreEl, setMoreEl] = React.useState<HTMLSpanElement | null>(null);
    const face = React.useMemo<PageHeaderPhoneFace>(() => ({ actionBar: barEl, more: moreEl }), [barEl, moreEl]);
    return (
      <ActionProvider>
        {mountMore && <span ref={setMoreEl} data-testid="top-more" />}
        <RecordContextProvider
          objectName="lead"
          recordId="1"
          data={{ id: '1', name: 'Mira Costa' }}
          objectSchema={{ name: 'lead', label: 'Lead' }}
          headerSystemActions={MENU_EDIT}
        >
          <PageHeaderPhoneContext.Provider value={face}>
            <PageHeader schema={schema} />
          </PageHeaderPhoneContext.Provider>
        </RecordContextProvider>
        <div ref={setBarEl} data-testid="bar" />
      </ActionProvider>
    );
  }

  const topMore = () => screen.getByTestId('top-more');

  it('the bar is the page\'s two actions, filling the row; the ⋯ is in the slot and holds the rest and Edit', async () => {
    render(<TopBarHost schema={{ type: 'page:header', actions: [convert, assign, ret] }} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Convert Lead', 'Assign']);
    for (const b of within(bar()).getAllByRole('button')) expect(b.className.split(/\s+/)).toContain('flex-1');
    expect(within(bar()).queryByRole('button', { name: 'More actions' })).toBeNull();
    await waitFor(() => expect(within(topMore()).getByRole('button', { name: 'More actions' })).toBeTruthy());
    expect(await openMore(topMore())).toEqual(['Return', 'Edit', 'Delete']);
  });

  it('with no page action the bar draws nothing, and the ⋯ in the slot holds Edit', async () => {
    render(<TopBarHost schema={{ type: 'page:header', actions: [] }} />);
    await waitFor(() => expect(within(topMore()).getByRole('button', { name: 'More actions' })).toBeTruthy());
    expect(bar().childElementCount).toBe(0);
    expect(await openMore(topMore())).toEqual(['Edit', 'Delete']);
  });

  it('nothing is drawn for the ⋯ until the slot exists; the bar\'s buttons still are', async () => {
    render(<TopBarHost schema={{ type: 'page:header', actions: [convert] }} mountMore={false} />);
    await waitFor(() => expect(bar().querySelector('[role="toolbar"]')).not.toBeNull());
    expect(barButtons()).toEqual(['Convert Lead']);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});
