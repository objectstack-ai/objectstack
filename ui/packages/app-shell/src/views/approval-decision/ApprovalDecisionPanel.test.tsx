/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval decision panel (objectui#12045, B1 of objectui#2763): how it
 * composes A3's progress with the request's declared decision actions over the
 * bound record, and that the package registers it as the page block
 * `record:approval_decision` `@objectstack/spec` 18 declares (objectui#12342),
 * so a page node of that type reaches it through the real `SchemaRenderer`.
 *
 * The bar is doubled to a probe that records the props it was handed: what is
 * under test here is the panel's wiring (which object, which record, which
 * location, what happens after a decision). The real bar, its dialog and the
 * POST it sends are pinned over the real record page in the console's
 * `approvalRequestsDataSource.decisionPage.test.tsx`.
 *
 * Off a request page the node draws a localized notice instead of nothing
 * (objectui#12072), so a block placed on the wrong page is visible to its
 * author. On a request page whose row has not loaded it still draws nothing.
 *
 * On a pending request the panel names who the step waits on (objectui#12482),
 * from the row it is bound to, as the approvals inbox's request sheet names
 * them. The same face on the real record page, over the console's routed
 * approvals source and objectstack's served page, is pinned in the console's
 * `approvalRequestsDataSource.servedPageApprovers-12482.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

const barProps: Array<Record<string, unknown>> = [];
vi.mock('../DeclaredActionsBar.js', () => ({
  DeclaredActionsBar: (props: Record<string, unknown>) => {
    barProps.push(props);
    return <div data-testid="declared-actions-probe" />;
  },
}));

import { ComponentRegistry } from '@object-ui/core';
import {
  AdapterCtx,
  MetadataCtx,
  RecordContextProvider,
  SchemaRenderer,
  subscribeDataChanges,
  type DataChange,
} from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ApprovalDecisionRenderer } from './ApprovalDecisionPanel';
import { resetApproverDirectoryCache } from '../../hooks/useApproverDirectory';
// The package's registration leaf, imported for its side effect as the
// package entry imports it (objectui#12342).
import '../record-approval-decision-renderer';

afterEach(() => {
  cleanup();
  barProps.length = 0;
});

const REQUEST = {
  id: 'req_12045',
  process_name: 'invoice_approval',
  object_name: 'invoice',
  record_id: 'inv_1',
  status: 'pending',
  pending_approvers: ['u1', 'u2', 'u3'],
  viewer: { can_act: true, is_submitter: false, can_override: false },
  decision_progress: { behavior: 'quorum', got: 1, need: 2 },
};

function mountOn(objectName: string, data: Record<string, unknown> | undefined) {
  return render(
    <RecordContextProvider objectName={objectName} recordId={(data?.id as string) ?? null} data={data}>
      <ApprovalDecisionRenderer />
    </RecordContextProvider>,
  );
}

/** The notice's pack key, and what one pack says for it. */
const NOTICE_KEY = 'approvalsInbox.decisionPanelOffRequestPage';
const packNotice = (language: string): unknown =>
  NOTICE_KEY.split('.').reduce<unknown>(
    (node, part) => (node as Record<string, unknown> | undefined)?.[part],
    (builtInLocales as Record<string, unknown>)[language],
  );

const noticeText = () => screen.getByTestId('approval-decision-off-request-page').textContent;

describe('the approval decision panel (objectui#12045)', () => {
  it('is registered as `record:approval_decision`, and under no bare name (objectui#12342)', () => {
    expect(ComponentRegistry.has('record:approval_decision')).toBe(true);
    expect(ComponentRegistry.get('record:approval_decision')).toBe(ApprovalDecisionRenderer);
    expect(ComponentRegistry.has('approval_decision'), 'skipFallback: no bare twin').toBe(false);
  });

  it('a page node of that type renders the panel through the real SchemaRenderer (objectui#12342)', () => {
    render(
      <RecordContextProvider objectName="sys_approval_request" recordId={REQUEST.id} data={REQUEST}>
        <SchemaRenderer schema={{ type: 'record:approval_decision' }} />
      </RecordContextProvider>,
    );
    expect(screen.getByTestId('approval-decision-panel')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(barProps[barProps.length - 1]).toMatchObject({ objectName: 'sys_approval_request', location: 'record_section' });
  });

  it("draws the request's tally and runs its declared actions at record_section against the request row", () => {
    mountOn('sys_approval_request', REQUEST);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(barProps).not.toHaveLength(0);
    const props = barProps[barProps.length - 1];
    expect(props.objectName).toBe('sys_approval_request');
    expect(props.location).toBe('record_section');
    expect(props.record).toMatchObject({ id: 'req_12045', viewer: REQUEST.viewer });
    expect(props.exclude, 'nothing is excluded: no other part of this page offers a decision').toBeUndefined();
    expect(screen.getByTestId('approval-decision-panel')).toBeTruthy();
    expect(screen.queryByTestId('approval-decision-off-request-page'), 'no notice on a request page').toBeNull();
  });

  it('draws no tally for a node that carries none, and still offers the actions', () => {
    mountOn('sys_approval_request', { ...REQUEST, decision_progress: undefined });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('declared-actions-probe')).toBeTruthy();
  });

  it('after a decision, the request record and the timeline are invalidated, not remounted', () => {
    mountOn('sys_approval_request', REQUEST);
    const changes: DataChange[] = [];
    const unsubscribe = subscribeDataChanges((change) => changes.push(change));
    try {
      (barProps[barProps.length - 1].onDone as () => void)();
    } finally {
      unsubscribe();
    }
    expect(changes).toEqual([
      { objectName: 'sys_approval_request', recordId: 'req_12045' },
      { objectName: 'sys_approval_action' },
    ]);
  });

  it('renders nothing on a request page whose record has not loaded', () => {
    const { container } = mountOn('sys_approval_request', undefined);
    expect(container.innerHTML).toBe('');
    expect(barProps).toHaveLength(0);
  });
});

describe('off an approval request page, a localized notice instead of nothing (objectui#12072)', () => {
  it.each([
    ["another object's record page", () => mountOn('invoice', { id: 'inv_1' })],
    ['a page with no record context', () => render(<ApprovalDecisionRenderer />)],
  ])('draws the notice on %s, and no panel', (_case, mount) => {
    mount();
    expect(noticeText()).toBe(packNotice('en'));
    expect(screen.queryByTestId('approval-decision-panel')).toBeNull();
    expect(barProps).toHaveLength(0);
  });

  it("keeps the node's className and designer attributes on the notice", () => {
    render(<ApprovalDecisionRenderer className="mt-4" data-obj-id="node_1" data-obj-type="record:approval_decision" />);
    const wrapper = screen.getByTestId('approval-decision-off-request-page').parentElement!;
    expect(wrapper.className).toBe('mt-4');
    expect(wrapper.getAttribute('data-obj-id')).toBe('node_1');
    expect(wrapper.getAttribute('data-obj-type')).toBe('record:approval_decision');
  });

  it('the notice copy is a key in all ten language packs', () => {
    const languages = Object.keys(builtInLocales);
    expect(languages).toHaveLength(10);
    for (const language of languages) {
      const value = packNotice(language);
      expect(typeof value, `${language} defines ${NOTICE_KEY}`).toBe('string');
      expect((value as string).trim(), `${language} defines ${NOTICE_KEY}`).not.toBe('');
    }
  });

  it('renders the active language: the zh pack value under a zh provider', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <RecordContextProvider objectName="invoice" recordId="inv_1" data={{ id: 'inv_1' }}>
          <ApprovalDecisionRenderer />
        </RecordContextProvider>
      </I18nProvider>,
    );
    expect(noticeText()).toBe(packNotice('zh'));
  });

  it('CONTROL: the en provider renders the en value, and the two packs differ', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <RecordContextProvider objectName="invoice" recordId="inv_1" data={{ id: 'inv_1' }}>
          <ApprovalDecisionRenderer />
        </RecordContextProvider>
      </I18nProvider>,
    );
    expect(noticeText()).toBe(packNotice('en'));
    expect(packNotice('zh')).not.toBe(packNotice('en'));
  });
});

describe('names who the pending step waits on (objectui#12482)', () => {
  /** The `position` registry, as the console's metadata store lists it. */
  const POSITIONS = [{ name: 'sales_manager', label: 'Regional Sales Manager' }];

  /** The directory reads behind a position: who holds the seat. */
  function directoryAdapter() {
    return {
      find: vi.fn(async (object: string) => {
        if (object === 'sys_user_position') return { data: [{ position: 'sales_manager', user_id: 'u_7' }] };
        if (object === 'sys_user') return { data: [{ id: 'u_7', full_name: 'Grace Hopper' }] };
        return { data: [] };
      }),
    };
  }

  function mountNamed(data: Record<string, unknown>) {
    const adapter = directoryAdapter();
    const ensureType = vi.fn(async (type: string) => (type === 'position' ? POSITIONS : []));
    const store = { ensureType } as unknown as React.ContextType<typeof MetadataCtx>;
    render(
      <MetadataCtx.Provider value={store}>
        <AdapterCtx.Provider value={adapter as never}>
          <RecordContextProvider objectName="sys_approval_request" recordId={String(data.id)} data={data}>
            <ApprovalDecisionRenderer />
          </RecordContextProvider>
        </AdapterCtx.Provider>
      </MetadataCtx.Provider>,
    );
    return { adapter, ensureType };
  }

  const chips = () => screen.queryAllByTestId('approver-chip');
  const panelText = () => screen.getByTestId('approval-decision-panel').textContent ?? '';

  beforeEach(() => resetApproverDirectoryCache());

  it('two people sharing one name in two countersign groups stay two chips, each named and labelled with its group', () => {
    mountNamed({
      ...REQUEST,
      pending_approvers: ['u_fin', 'u_leg'],
      pending_approver_names: { u_fin: 'Dev Admin', u_leg: 'Dev Admin' },
      pending_approver_groups: { u_fin: ['Finance'], u_leg: ['Legal'] },
      decision_progress: {
        behavior: 'per_group',
        got: 0,
        need: 2,
        groups: [
          { group: 'Finance', got: 0, need: 1, satisfied: false },
          { group: 'Legal', got: 0, need: 1, satisfied: false },
        ],
      },
    });
    const row = screen.getByTestId('approval-decision-pending-approvers');
    expect(row.textContent).toContain('Waiting on');
    expect(chips().map((chip) => chip.textContent)).toEqual(['Dev Admin· Finance', 'Dev Admin· Legal']);
    expect(chips().map((chip) => chip.getAttribute('title'))).toEqual(['u_fin', 'u_leg']);
    expect(panelText()).not.toContain('u_fin');
    expect(panelText()).not.toContain('u_leg');
  });

  it('one person holding three quorum slots is one named chip with a count, never the raw id (objectui#12077)', () => {
    const id = 'usr_qFpo8Zk2LmN4pR7t';
    mountNamed({
      ...REQUEST,
      pending_approvers: [id, id, id],
      pending_approver_names: { [id]: 'Ada Lovelace' },
    });
    expect(chips().map((chip) => chip.textContent)).toEqual(['Ada Lovelace×3']);
    expect(chips()[0].getAttribute('title')).toBe(id);
    expect(panelText()).not.toContain('qFpo');
  });

  it("a position the server left unnamed reads its registry label and its holder, never the raw reference", async () => {
    const { ensureType, adapter } = mountNamed({ ...REQUEST, pending_approvers: ['position:sales_manager'] });
    // Re-queried each time: the chip is keyed by its label, so it is a new
    // element once the label resolves.
    await waitFor(() =>
      expect(screen.getByTitle('position:sales_manager').textContent).toBe('Regional Sales Manager· Grace Hopper'),
    );
    expect(ensureType).toHaveBeenCalledWith('position');
    expect(adapter.find.mock.calls.map(([object]) => object)).toEqual(['sys_user_position', 'sys_user']);
    expect(panelText()).not.toContain('position:');
    expect(panelText()).not.toContain('positi…');
  });

  it("CONTROL: the server's own name wins, and the directory is asked nothing", () => {
    const { ensureType, adapter } = mountNamed({
      ...REQUEST,
      pending_approvers: ['position:sales_manager'],
      pending_approver_names: { 'position:sales_manager': 'Sales Manager (served)' },
    });
    expect(screen.getByTitle('position:sales_manager').textContent).toBe('Sales Manager (served)');
    expect(ensureType).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('CONTROL: an id nothing can name keeps the face the inbox sheet draws for it, the raw id on hover only', () => {
    mountNamed({ ...REQUEST, pending_approvers: ['zzUnresolvedIdXyz123'] });
    const chip = screen.getByTitle('zzUnresolvedIdXyz123');
    expect(chip.textContent).toBe('zzUnre…z123');
    expect(panelText()).not.toContain('zzUnresolvedIdXyz123');
  });

  it('CONTROL: a request with no pending approvers draws no "Waiting on" row, and still its tally and decisions', () => {
    mountNamed({ ...REQUEST, pending_approvers: [] });
    expect(screen.queryByTestId('approval-decision-pending-approvers')).toBeNull();
    expect(chips()).toHaveLength(0);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByTestId('declared-actions-probe')).toBeTruthy();
  });

  it('CONTROL: a decided request names no one, even when its row still lists slots', () => {
    const { ensureType, adapter } = mountNamed({
      ...REQUEST,
      status: 'approved',
      decision_progress: undefined,
      pending_approvers: ['u_fin', 'position:sales_manager'],
      pending_approver_names: { u_fin: 'Dev Admin' },
    });
    expect(screen.queryByTestId('approval-decision-pending-approvers')).toBeNull();
    expect(within(screen.getByTestId('approval-decision-panel')).queryByText(/Dev Admin/)).toBeNull();
    expect(ensureType).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('a first_response node, which carries no tally, still names who it waits on', () => {
    mountNamed({
      ...REQUEST,
      decision_progress: undefined,
      pending_approvers: ['u_fin'],
      pending_approver_names: { u_fin: 'Dev Admin' },
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(chips().map((chip) => chip.textContent)).toEqual(['Dev Admin']);
  });
});
