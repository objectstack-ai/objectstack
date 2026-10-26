// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12488 — a decision's Branches draw as branch cards.
 *
 * - A decision whose `config.conditions` holds branches shows one card per
 *   branch: the target in the card's header, Label and Expression under it.
 *   An edit commits through the SAME path the Branches list always used: the
 *   node's `config.conditions` and, mirrored by `flow-decision-edges`, the
 *   bound out-edge. No third store.
 * - A decision that routes on its out-edge conditions (empty `conditions`,
 *   HotCRM's shape) shows each out-edge read-only, with its target and its
 *   condition, instead of "No items yet.". Without a host that can move the
 *   selection (the metadata-admin designer) no "Edit connection" link is drawn.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { decisionEdgeBranches } from './FlowObjectListField';
import { InspectorShellHostProvider } from './_shared';
import type { MetadataSelection } from '../preview-registry';
import { t } from '../i18n';

afterEach(cleanup);

const en = (key: string) => t(key, 'en');

/** HotCRM's `campaign_enrollment` decision, trimmed to the keys read here. */
const EDGE_ROUTED = {
  nodes: [
    { id: 'check_campaign_open', type: 'decision', label: 'Campaign Open?' },
    { id: 'find_leads', type: 'get_record', label: 'Find Eligible Leads' },
    { id: 'find_contacts', type: 'get_record', label: 'Find Eligible Contacts' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e4', source: 'check_campaign_open', target: 'find_leads', type: 'conditional', label: 'Open · Leads', condition: 'vars.memberSource != "contacts"' },
    { id: 'e7', source: 'check_campaign_open', target: 'find_contacts', type: 'conditional', label: 'Open · Contacts', condition: { dialect: 'cel', source: 'vars.memberSource == "contacts"' } },
    { id: 'eF', source: 'check_campaign_open', target: 'end', type: 'fault' },
  ],
};

function renderInspector(draft: Record<string, unknown>, id: string, host?: { onSelectionChange: (s: MetadataSelection) => void }) {
  const onPatch = vi.fn();
  const el = (
    <FlowNodeInspector
      type="flow"
      name="probe"
      draft={draft}
      selection={{ kind: 'node', id } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />
  );
  render(host ? <InspectorShellHostProvider value={host}>{el}</InspectorShellHostProvider> : el);
  return onPatch;
}

describe('decisionEdgeBranches (objectui#12488)', () => {
  it('reads the decision’s plain out-edges in edge order, with target label and condition', () => {
    expect(decisionEdgeBranches('check_campaign_open', EDGE_ROUTED.edges as never, EDGE_ROUTED.nodes)).toEqual([
      { key: 'e4', target: 'find_leads', targetLabel: 'Find Eligible Leads', label: 'Open · Leads', condition: 'vars.memberSource != "contacts"', isDefault: false },
      { key: 'e7', target: 'find_contacts', targetLabel: 'Find Eligible Contacts', label: 'Open · Contacts', condition: 'vars.memberSource == "contacts"', isDefault: false },
    ]);
  });
});

describe('an edge-routed decision shows its out-edges as read-only branch cards (objectui#12488)', () => {
  it('lists target and condition per out-edge, and no "No items yet."', () => {
    renderInspector(EDGE_ROUTED, 'check_campaign_open');
    const cards = screen.getAllByTestId('flow-branch-card');
    expect(cards.map((c) => c.getAttribute('data-edge-key'))).toEqual(['e4', 'e7']);
    expect(within(cards[0]).getByText('Find Eligible Leads')).toBeInTheDocument();
    expect((within(cards[1]).getByRole('textbox') as HTMLTextAreaElement).value).toBe('vars.memberSource == "contacts"');
    expect(screen.queryByText(en('engine.inspector.flowNode.list.empty'))).toBeNull();
    // The metadata-admin designer gives no host: no link, and its own header stays.
    expect(screen.queryByRole('button', { name: en('engine.inspector.flowNode.branch.openEdge') })).toBeNull();
    expect(screen.getByRole('button', { name: en('engine.inspector.flowNode.close') })).toBeInTheDocument();
  });

  it('under a host, "Edit connection" selects that edge by its canvas key', () => {
    const onSelectionChange = vi.fn();
    renderInspector(EDGE_ROUTED, 'check_campaign_open', { onSelectionChange });
    const [, second] = screen.getAllByTestId('flow-branch-card');
    fireEvent.click(within(second).getByRole('button', { name: en('engine.inspector.flowNode.branch.openEdge') }));
    // Labelled by the nodes' names, as the canvas labels it (objectui#13200).
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: 'edge', id: 'e7', label: 'Campaign Open? → Find Eligible Contacts' });
    // Under a host the shell draws no header of its own.
    expect(screen.queryByRole('button', { name: en('engine.inspector.flowNode.close') })).toBeNull();
  });
});

describe('a decision with Branches edits them as cards, through the same write (objectui#12488)', () => {
  const draft = {
    nodes: [
      { id: 'd', type: 'decision', label: 'Route', config: { conditions: [{ label: 'Big', expression: 'amount > 10' }] } },
      { id: 'big', type: 'end', label: 'Big deal' },
    ],
    edges: [{ id: 'eb', source: 'd', target: 'big', label: 'Big', condition: 'amount > 10' }],
  };

  it('an expression edit stores the branch and mirrors onto its bound edge', () => {
    const onPatch = renderInspector(draft, 'd');
    const [card] = screen.getAllByTestId('flow-branch-card');
    expect(card.getAttribute('data-edge-key')).toBeNull();
    const expr = within(within(card).getByRole('group', { name: 'Expression' })).getByRole('textbox');
    expect(expr.tagName).toBe('TEXTAREA');
    fireEvent.change(expr, { target: { value: 'amount > 20' } });
    fireEvent.blur(expr);
    const patch = onPatch.mock.calls.at(-1)![0] as { nodes: Array<{ config: unknown }>; edges: Array<Record<string, unknown>> };
    expect(patch.nodes[0].config).toEqual({ conditions: [{ label: 'Big', expression: 'amount > 20' }] });
    expect(patch.edges).toEqual([{ id: 'eb', source: 'd', target: 'big', label: 'Big', condition: 'amount > 20' }]);
  });
});
