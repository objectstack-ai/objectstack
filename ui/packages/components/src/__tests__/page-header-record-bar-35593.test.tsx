/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35593 — the record's header is ONE row: where the host offers
 * its bar (`RecordHeaderBarContext`), `page:header` draws the record's name,
 * its stage tag and the state's tags into the bar's title slot and its ONE
 * button group into the bar's action slot, and draws no row of its own. In
 * the bar the record's group is Edit, up to three inline actions (the primary
 * first) and the `⋯` — objectstack#35853 gave the bar the default budget of 3
 * back (#35593 had set it to 1), folding by width where the bar is narrow. A state (`RecordHeaderStateContext`) may hand a `group` that takes the
 * record's row, getting the record's actions as `⋯` items to fold in.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import '../renderers';
// `page` reaches the react runtime through a dynamic import: pay that load at
// collection, not inside a clocked case.
import '@object-ui/react-runtime';
import {
  RecordHeaderBarContext,
  RecordHeaderStateContext,
  type RecordHeaderGroupParts,
  type RecordHeaderState,
} from '../renderers/layout/record-header-bar-context';

afterEach(() => cleanup());

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const LEAD = { id: 'lead-1', name: 'Mira Costa', status: 'contacted' };
const LEAD_SCHEMA = {
  name: 'crm_lead',
  label: 'Lead',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'new', label: 'New' },
        { value: 'contacted', label: 'Contacted' },
      ],
    },
  },
};

const HOST_ACTIONS = [
  { name: 'sys_edit', label: 'Edit', icon: 'pencil', order: 100, onClick: vi.fn() },
  { name: 'sys_delete', label: 'Delete', order: 120, variant: 'destructive', component: 'action:menu', onClick: vi.fn() },
];

const act = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  type: 'url',
  target: `https://example.com/${name}`,
  locations: ['record_header'],
  ...extra,
});

const ACTIONS = [act('convert', 'Convert', { variant: 'primary' }), act('log_call', 'Log call'), act('send_email', 'Send email')];

/** A host bar: two slots and a claim, as the record page's top bar offers. */
function BarHost({ claim, children }: { claim: (claimed: boolean) => void; children: React.ReactNode }) {
  const [titleSlot, setTitleSlot] = React.useState<HTMLElement | null>(null);
  const [actionSlot, setActionSlot] = React.useState<HTMLElement | null>(null);
  const bar = React.useMemo(() => ({ titleSlot, actionSlot, claim }), [titleSlot, actionSlot, claim]);
  return (
    <>
      <div data-testid="bar">
        <span ref={setTitleSlot} data-testid="title-slot" />
        <span ref={setActionSlot} data-testid="action-slot" />
      </div>
      <RecordHeaderBarContext.Provider value={bar}>{children}</RecordHeaderBarContext.Provider>
    </>
  );
}

function renderHeader({
  schema = { type: 'page:header', actions: ACTIONS },
  bar,
  state,
}: { schema?: any; bar?: (claimed: boolean) => void; state?: RecordHeaderState } = {}) {
  const header = (
    <ActionProvider>
      <RecordContextProvider
        objectName="crm_lead"
        recordId={LEAD.id}
        data={LEAD}
        objectSchema={LEAD_SCHEMA}
        headerSystemActions={HOST_ACTIONS}
      >
        <RecordHeaderStateContext.Provider value={state ?? null}>
          <PageHeader schema={schema} />
        </RecordHeaderStateContext.Provider>
      </RecordContextProvider>
    </ActionProvider>
  );
  return render(bar ? <BarHost claim={bar}>{header}</BarHost> : header);
}

const inlineButtons = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('button')).map((b) => b.textContent?.trim() || b.getAttribute('aria-label'));

describe('page:header in the host bar (objectstack#35593)', () => {
  it('draws the name and stage tag into the title slot, the group into the action slot, and no row of its own', async () => {
    const claim = vi.fn();
    const { unmount } = renderHeader({ bar: claim });

    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.textContent).toContain('Mira Costa'));
    expect(titleSlot.querySelector('[data-record-stage-tag="status"]')?.textContent).toBe('Contacted');
    // The bar's navigation row names the object or the list; the chip does not repeat it.
    expect(titleSlot.textContent).not.toContain('Lead');
    expect(document.querySelector('header')).toBeNull();
    expect(claim).toHaveBeenCalledWith(true);

    unmount();
    expect(claim).toHaveBeenLastCalledWith(false);
  });

  it('in the bar the record draws Edit, up to three inline actions (the primary first) and the ⋯', async () => {
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Send email'));

    const labels = inlineButtons(actionSlot);
    expect(labels).toContain('Edit');
    expect(labels.indexOf('Convert')).toBe(0);
    expect(labels).toContain('Log call');
  });

  it('an authored maxVisible still sets the budget in the bar', async () => {
    renderHeader({ bar: vi.fn(), schema: { type: 'page:header', actions: ACTIONS, maxVisible: 1 } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    expect(inlineButtons(actionSlot)).not.toContain('Log call');
    expect(inlineButtons(actionSlot)).not.toContain('Send email');
  });

  it('recordChrome: false keeps its bare header and never claims the bar', () => {
    const claim = vi.fn();
    renderHeader({ bar: claim, schema: { type: 'page:header', actions: ACTIONS, recordChrome: false } });
    expect(claim).not.toHaveBeenCalled();
    expect(screen.getByTestId('title-slot').childElementCount).toBe(0);
  });

  it('draws the state\'s tags after the record\'s name', async () => {
    renderHeader({ bar: vi.fn(), state: { tags: <span data-testid="state-tag">待你审批</span> } });
    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.querySelector('[data-testid="state-tag"]')).toBeTruthy());
  });
});

describe('the record state\'s ONE group (objectstack#35593)', () => {
  it('hands the group the record\'s row and the record\'s actions as ⋯ items, and draws what it returns', async () => {
    const seen: RecordHeaderGroupParts[] = [];
    const group = (parts: RecordHeaderGroupParts) => {
      seen.push(parts);
      return <button type="button" data-testid="state-lead">通过</button>;
    };
    renderHeader({ bar: vi.fn(), state: { group } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(actionSlot.querySelector('[data-testid="state-lead"]')).toBeTruthy());

    const last = seen[seen.length - 1];
    expect(last.face).toBe('row');
    expect(last.recordRow).toBeTruthy();
    expect(last.recordMenuItems).toBeTruthy();
    // The group took the row: the record's own inline buttons are not drawn.
    expect(inlineButtons(actionSlot)).not.toContain('Convert');
  });

  it('a group that returns the record\'s row draws the record\'s row unchanged', async () => {
    renderHeader({ bar: vi.fn(), state: { group: (parts) => parts.recordRow } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
  });

  it('without a host bar the state\'s tags sit under the record\'s name', async () => {
    renderHeader({ state: { tags: <span data-testid="state-tag">审批中</span> } });
    await waitFor(() => expect(document.querySelector('[data-record-header-tags] [data-testid="state-tag"]')).toBeTruthy());
  });
});

/**
 * objectstack#35853 — in the host bar the budget is 3 and folds by width: while
 * the row's buttons wrap past one line, the page's own actions fold into the
 * `⋯` one at a time, down to the primary; the host's Edit never folds. jsdom
 * lays nothing out, so the row's line is stubbed: a child at index 3 or later
 * sits on a second line.
 */
describe('page:header in the host bar folds by width (objectstack#35853)', () => {
  afterEach(() => vi.restoreAllMocks());

  const wrapFromIndex = (first: number) =>
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      const row = this.parentElement;
      if (!row || row.getAttribute('role') !== 'toolbar') return 0;
      return Array.from(row.children).indexOf(this) >= first ? 40 : 0;
    });

  it('a row that wraps folds the page\'s actions down to the primary, and keeps Edit', async () => {
    wrapFromIndex(3);
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Convert'));
    await waitFor(() => expect(inlineButtons(actionSlot)).not.toContain('Log call'));
    const labels = inlineButtons(actionSlot);
    expect(labels).toContain('Edit');
    expect(labels).not.toContain('Send email');
  });

  it('CONTROL: a row on one line keeps all three', async () => {
    wrapFromIndex(99);
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Send email'));
    expect(inlineButtons(actionSlot)).toContain('Log call');
  });

  it('CONTROL: outside the bar the row never folds by width', async () => {
    wrapFromIndex(1);
    renderHeader();
    await waitFor(() => expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toContain('Send email'));
  });
});
