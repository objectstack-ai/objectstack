/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35891 — the default record page draws no stage bar, so the
 * header's stage tag is where the stage is read and moved:
 *
 * - a host's `RecordHeaderState.stage` gets the tag the header would draw (its
 *   field, its label, the tag itself) and draws what it returns in its place,
 *   in the host bar and in the header's own row;
 * - without a host bar (a phone, a page with no top bar) the tag now sits in
 *   the row under the record's name, beside the state's tags — before, only
 *   the bar drew it, so a phone showed no stage at all;
 * - without `stage` the tag is the plain readout.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import '../renderers';
import '@object-ui/react-runtime';
import {
  RecordHeaderBarContext,
  RecordHeaderStateContext,
  type RecordHeaderStageParts,
  type RecordHeaderState,
} from '../renderers/layout/record-header-bar-context';

afterEach(() => cleanup());

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const DEAL = { id: 'opp-1', name: 'Wayne Enterprise License', stage: 'negotiation' };
const DEAL_SCHEMA = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  stageField: 'stage',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'prospecting', label: 'Prospecting' },
        { value: 'negotiation', label: 'Negotiation' },
      ],
    },
  },
};

function BarHost({ children }: { children: React.ReactNode }) {
  const [titleSlot, setTitleSlot] = React.useState<HTMLElement | null>(null);
  const [actionSlot, setActionSlot] = React.useState<HTMLElement | null>(null);
  const claim = React.useCallback(() => {}, []);
  const bar = React.useMemo(() => ({ titleSlot, actionSlot, claim }), [titleSlot, actionSlot, claim]);
  return (
    <>
      <span ref={setTitleSlot} data-testid="title-slot" />
      <span ref={setActionSlot} data-testid="action-slot" />
      <RecordHeaderBarContext.Provider value={bar}>{children}</RecordHeaderBarContext.Provider>
    </>
  );
}

function renderHeader({ bar = false, state }: { bar?: boolean; state?: RecordHeaderState } = {}) {
  const header = (
    <ActionProvider>
      <RecordContextProvider objectName="crm_opportunity" recordId={DEAL.id} data={DEAL} objectSchema={DEAL_SCHEMA}>
        <RecordHeaderStateContext.Provider value={state ?? null}>
          <PageHeader schema={{ type: 'page:header' }} />
        </RecordHeaderStateContext.Provider>
      </RecordContextProvider>
    </ActionProvider>
  );
  return render(bar ? <BarHost>{header}</BarHost> : header);
}

describe('the header stage tag (objectstack#35891)', () => {
  it('without a host bar the stage tag sits under the record name, before the state tags', async () => {
    renderHeader({ state: { tags: <span data-testid="state-tag">审批中</span> } });
    await waitFor(() => expect(document.querySelector('[data-record-header-tags]')).toBeTruthy());
    const row = document.querySelector('[data-record-header-tags]')!;
    expect(row.querySelector('[data-record-stage-tag="stage"]')?.textContent).toBe('Negotiation');
    expect(row.firstElementChild?.getAttribute('data-record-stage-tag')).toBe('stage');
  });

  it('without a host bar and without state tags the stage tag still draws (a phone shows the stage)', async () => {
    renderHeader();
    await waitFor(() => expect(document.querySelector('[data-record-header-tags] [data-record-stage-tag="stage"]')).toBeTruthy());
  });

  it('a host stage gets the field, the label and the plain tag, and draws in its place (no bar)', async () => {
    const seen: RecordHeaderStageParts[] = [];
    const stage = vi.fn((parts: RecordHeaderStageParts) => {
      seen.push(parts);
      return <button type="button" data-testid="stage-menu">{parts.label} ▾</button>;
    });
    renderHeader({ state: { stage } });
    await waitFor(() => expect(screen.getByTestId('stage-menu')).toBeTruthy());
    const last = seen[seen.length - 1];
    expect(last.field).toBe('stage');
    expect(last.label).toBe('Negotiation');
    expect(last.tag).toBeTruthy();
    // The plain tag is not drawn beside the host's control.
    expect(document.querySelector('[data-record-header-tags] span[data-record-stage-tag]')).toBeNull();
  });

  it('a host stage draws in the host bar\'s title slot too', async () => {
    renderHeader({ bar: true, state: { stage: (parts) => <button type="button" data-testid="stage-menu">{parts.label}</button> } });
    const titleSlot = screen.getByTestId('title-slot');
    await waitFor(() => expect(titleSlot.querySelector('[data-testid="stage-menu"]')?.textContent).toBe('Negotiation'));
  });

  it('control: a record with no stage value draws no tag and never asks the host', async () => {
    const stage = vi.fn(() => <span />);
    render(
      <ActionProvider>
        <RecordContextProvider objectName="crm_opportunity" recordId="opp-2" data={{ id: 'opp-2', name: 'Blank' }} objectSchema={DEAL_SCHEMA}>
          <RecordHeaderStateContext.Provider value={{ stage }}>
            <PageHeader schema={{ type: 'page:header' }} />
          </RecordHeaderStateContext.Provider>
        </RecordContextProvider>
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.getByText('Blank')).toBeTruthy());
    expect(document.querySelector('[data-record-stage-tag]')).toBeNull();
    expect(stage).not.toHaveBeenCalled();
  });
});
