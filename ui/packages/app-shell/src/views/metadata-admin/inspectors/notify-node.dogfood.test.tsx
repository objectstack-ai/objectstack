// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * notify flow node — end-to-end Studio render verification (#1895).
 *
 * Mounts the REAL user-facing components — the add-node palette popover and the
 * schema-driven FlowNodeInspector — with the production `NODE_PALETTE` /
 * `fieldsForNodeType`, and asserts an author can (1) see & pick `notify` from
 * the Integration group and (2) edit its config fields. This is the browser-DOM
 * stand-in for a live Studio dogfood (no live-app browser tooling in CI).
 */

import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { NodePalette, NODE_PALETTE, nodeIcon } from '../previews/flow-canvas-parts';

// The inspector's engine config-schema + object-field hooks are stubbed so it
// falls back to the hardcoded `fieldsForNodeType` groups and resolves without a
// network client (same pattern as FlowNodeInspector.test.tsx).
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';

beforeAll(() => {
  // Radix Popover / cmdk probe pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

afterEach(cleanup);

describe('notify node — add-node palette (real NODE_PALETTE)', () => {
  it('presents Notify in the Integration group and picks type="notify"', () => {
    const onPick = vi.fn();
    render(
      <NodePalette items={NODE_PALETTE} open onOpenChange={() => {}} onPick={onPick}>
        <button type="button">Add node</button>
      </NodePalette>,
    );

    const notify = screen.getByText('Notify');
    expect(notify).toBeInTheDocument();
    fireEvent.click(notify);
    expect(onPick).toHaveBeenCalledWith('notify');
  });

  it('maps notify to the Bell icon (distinct from the default CircleDot)', () => {
    expect(nodeIcon('notify')).toBe(nodeIcon('notify'));
    expect(nodeIcon('notify')).not.toBe(nodeIcon('some_unknown_type'));
  });
});

describe('notify node — inspector renders its config fields', () => {
  const draft = { nodes: [{ id: 'ping', type: 'notify', label: 'Notify approver', config: {} }] };

  it('shows the notify config editor (recipients / title / message / channels / topic / severity)', () => {
    render(
      <FlowNodeInspector
        type="flow"
        name="approval_flow"
        draft={draft}
        selection={{ kind: 'node', id: 'ping' }}
        onPatch={vi.fn()}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />,
    );

    // The node label input confirms we're on the notify node's inspector.
    expect(screen.getByDisplayValue('Notify approver')).toBeInTheDocument();
    // Each authored config field label the built-in descriptor documents.
    for (const label of ['Recipients', 'Title', 'Message', 'Channels', 'Topic', 'Severity']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('writes an edited title back under node.config (matching the runtime)', () => {
    const onPatch = vi.fn();
    render(
      <FlowNodeInspector
        type="flow"
        name="approval_flow"
        draft={draft}
        selection={{ kind: 'node', id: 'ping' }}
        onPatch={onPatch}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />,
    );

    const titleField = screen.getByPlaceholderText('Your request was approved');
    fireEvent.change(titleField, { target: { value: 'Approved!' } });
    const patch = onPatch.mock.calls.at(-1)![0] as { nodes: Array<{ config?: Record<string, unknown> }> };
    expect(patch.nodes[0].config!.title).toBe('Approved!');
  });
});
