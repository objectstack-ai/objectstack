// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12742 — the simulator mocks an `http` node, the spec's HTTP node
 * type, and the Debug panel offers it a mock-output field. Before this card
 * both tables (`MOCKED_SIDE_EFFECT` in the simulator, `MOCKABLE` in the panel)
 * named `http_request` and not `http`, so the node the palette adds passed
 * through unmocked, as if it had no side effect. Spec 18 reserves
 * `http_request`, `http_call` and `webhook` (the authoring doors refuse them, a
 * stored row loads as `http`), so neither table names them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FlowSimulatorPanel } from './FlowSimulatorPanel';
import { FlowSimulator } from './simulator/flow-simulator';
import type { SimEdge, SimNode } from './simulator/flow-sim-types';

afterEach(cleanup);

const flowWith = (type: string): { nodes: SimNode[]; edges: SimEdge[] } => ({
  nodes: [
    { id: 's', type: 'start' },
    { id: 'h', type, label: 'Enqueue Billing Hand-off', config: { method: 'POST', url: 'https://billing.example/handoff' } },
    { id: 'e', type: 'end' },
  ],
  edges: [
    { source: 's', target: 'h' },
    { source: 'h', target: 'e' },
  ],
});

function stepStatus(type: string): string | undefined {
  const { nodes, edges } = flowWith(type);
  const sim = new FlowSimulator(nodes, edges);
  sim.reset({}, {});
  sim.runToEnd();
  return sim.state.steps.find((s) => s.nodeId === 'h')?.status;
}

describe('the simulator mocks an `http` node (objectui#12742)', () => {
  it('records the step as mocked', () => {
    expect(stepStatus('http')).toBe('mocked');
  });

  it('keeps no mock entry for a reserved name', () => {
    for (const name of ['http_request', 'http_call', 'webhook']) expect(stepStatus(name), name).toBe('ok');
  });

  it('the Debug panel offers the `http` node a mock-output field', () => {
    const { nodes, edges } = flowWith('http');
    render(<FlowSimulatorPanel nodes={nodes} edges={edges} variables={[]} />);
    expect(screen.getByText('Mock outputs')).toBeInTheDocument();
    const label = screen.getByText('Enqueue Billing Hand-off');
    expect(label.closest('label')).toHaveAttribute('title', 'h');
    fireEvent.change(label.closest('div')!.querySelector('input')!, { target: { value: '{"ok":true}' } });
    expect(screen.getByDisplayValue('{"ok":true}')).toBeInTheDocument();
  });
});
