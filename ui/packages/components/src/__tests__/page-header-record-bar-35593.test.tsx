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
 * the bar the record's group is Edit, ONE inline action (the primary) and the
 * `⋯`. A state (`RecordHeaderStateContext`) may hand a `group` that takes the
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
    // The bar's crumb names the object; the chip does not repeat it.
    expect(titleSlot.textContent).not.toContain('Lead');
    expect(document.querySelector('header')).toBeNull();
    expect(claim).toHaveBeenCalledWith(true);

    unmount();
    expect(claim).toHaveBeenLastCalledWith(false);
  });

  it('in the bar the record draws Edit, ONE inline action (the primary) and the ⋯', async () => {
    renderHeader({ bar: vi.fn() });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(actionSlot.querySelector('button')).toBeTruthy());

    const labels = inlineButtons(actionSlot);
    expect(labels).toContain('Edit');
    expect(labels).toContain('Convert');
    expect(labels).not.toContain('Log call');
    expect(labels).not.toContain('Send email');
  });

  it('an authored maxVisible still sets the budget in the bar', async () => {
    renderHeader({ bar: vi.fn(), schema: { type: 'page:header', actions: ACTIONS, maxVisible: 3 } });
    const actionSlot = screen.getByTestId('action-slot');
    await waitFor(() => expect(inlineButtons(actionSlot)).toContain('Send email'));
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

// objectstack#35415 — the host's name for the record (`RecordHeaderState.title`)
// is the heading in both faces, its node drawn inside the H1; absent or empty,
// the header's own title stands.
describe('the record state\'s title (objectstack#35415)', () => {
  const HOST_TITLE = { text: 'Acceptance T-002', node: <a href="/subject" data-testid="host-title-node">Acceptance T-002</a> };

  it('in the host bar: the H1 draws the host\'s node in place of the record\'s own name', async () => {
    renderHeader({ bar: vi.fn(), state: { title: HOST_TITLE } });
    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.querySelector('h1')?.textContent).toBe('Acceptance T-002'));
    expect(titleSlot.querySelector('h1 [data-testid="host-title-node"]')?.getAttribute('href')).toBe('/subject');
    expect(titleSlot.textContent).not.toContain('Mira Costa');
  });

  it('without a host bar: the header row\'s H1 is the host\'s name too', async () => {
    renderHeader({ state: { title: HOST_TITLE } });
    await waitFor(() => expect(document.querySelector('header h1')?.textContent).toBe('Acceptance T-002'));
    expect(document.querySelector('header h1 [data-testid="host-title-node"]')).toBeTruthy();
  });

  it('a host title with no node draws its text', async () => {
    renderHeader({ state: { title: { text: 'Acceptance T-002' } } });
    await waitFor(() => expect(document.querySelector('header h1')?.textContent).toBe('Acceptance T-002'));
  });

  it('CONTROL — an empty host title leaves the record\'s own name', async () => {
    renderHeader({ state: { title: { text: '  ', node: <span>ignored</span> } } });
    await waitFor(() => expect(document.querySelector('header h1')?.textContent).toBe('Mira Costa'));
  });
});
