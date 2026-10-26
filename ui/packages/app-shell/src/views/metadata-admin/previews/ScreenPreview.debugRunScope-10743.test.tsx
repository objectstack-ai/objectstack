// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Debug run's paused screen decides a field's `visibleWhen` live, through
 * the flow runner's own renderer, over the screen's declared fields and the
 * values the author is collecting — never over the run's variables
 * (objectui#10743). Every run goes through the real `FlowSimulator`, and every
 * screen through the real `ScreenPreview` → `ScreenView`, the way
 * `FlowSimulatorPanel` mounts them (`node` + `snapshot.variables`).
 *
 * The three cases are the ruling's three pins, each with a control field that
 * declares no predicate in the same tree:
 *
 * 1. a sibling-field predicate reveals its field live (the console sample's
 *    `note`, `visibleWhen: 'discount > 0'`, and the docs shape
 *    `createOpportunity == true`) — the Debug run used to judge the predicate
 *    once against the run's variables, drop the field and strip the predicate,
 *    so nothing the author typed or ticked ever brought it back;
 * 2. a predicate over a run variable is not read from the run's variables, and
 *    the screen step names it as an error;
 * 3. the control: a field with no predicate is drawn throughout.
 *
 * ⛔ Whether the renderer SHOWS or HIDES a predicate it cannot evaluate is its
 * own fallback and objectui#8069's question. Pin 2 therefore reads the SCOPE
 * only: the render is the same whether the run variable is `true` or `false`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ fake: 'adapter' }),
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: [] }),
}));

import { ScreenPreview } from './ScreenPreview';
import { FlowSimulator } from './simulator/flow-simulator';
import type { SimEdge, SimNode } from './simulator/flow-sim-types';

afterEach(() => cleanup());

/** The console preview sample's `review` screen (apps/console `preview-samples.ts`), plus a control field. */
const consoleSample: SimNode = {
  id: 'review',
  type: 'screen',
  label: 'CSM review',
  config: {
    fields: [
      { name: 'discount', label: 'Discount %', type: 'number', required: false },
      { name: 'note', label: 'Note', type: 'text', required: true, visibleWhen: 'discount > 0' },
      { name: 'comment', label: 'Comment', type: 'text' },
    ],
  },
};

/** The docs' lead-conversion screen (`content/docs/automation/flows.mdx`), plus a control field. */
const docsShape: SimNode = {
  id: 'screen_1',
  type: 'screen',
  label: 'Conversion Details',
  config: {
    fields: [
      { name: 'createOpportunity', label: 'Create Opportunity?', type: 'boolean', required: true, defaultValue: false },
      { name: 'opportunityName', label: 'Opportunity Name', type: 'text', required: true, visibleWhen: 'createOpportunity == true' },
      { name: 'plain', label: 'Plain', type: 'text' },
    ],
  },
};

/** A predicate over a run variable — nothing on this screen declares `needsApproval`. */
const runVariableShape: SimNode = {
  id: 'gate',
  type: 'screen',
  label: 'Gate',
  config: {
    fields: [
      { name: 'reason', label: 'Reason', type: 'text', required: true, visibleWhen: 'needsApproval == true' },
      { name: 'plain', label: 'Plain', type: 'text' },
    ],
  },
};

/** start → `node` → end, run to the screen pause with `seed` as the run's variables. */
function pauseAt(node: SimNode, seed: Record<string, unknown> = {}) {
  const nodes: SimNode[] = [{ id: 'start', type: 'start' }, node, { id: 'end', type: 'end' }];
  const edges: SimEdge[] = [
    { id: 'e1', source: 'start', target: node.id },
    { id: 'e2', source: node.id, target: 'end' },
  ];
  const sim = new FlowSimulator(nodes, edges);
  sim.reset(seed);
  sim.runToEnd();
  expect(sim.state.status).toBe('paused');
  expect(sim.state.pausedReason).toBe('screen');
  const step = sim.state.steps.find((st) => st.nodeId === node.id);
  return { sim, step, node, variables: sim.state.variables };
}

describe('the Debug run screen decides a sibling-field visibleWhen live (objectui#10743)', () => {
  it('console sample: typing a discount above zero reveals Note; zero hides it; Comment (no predicate) is drawn throughout', () => {
    const { node, variables, step } = pauseAt(consoleSample);
    const { container } = render(<ScreenPreview node={node} variables={variables} />);
    const discount = container.querySelector('#ff-discount') as HTMLInputElement | null;
    expect(discount).not.toBeNull();
    expect(screen.getByText('Comment')).toBeInTheDocument();

    fireEvent.change(discount!, { target: { value: '5' } });
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('Comment')).toBeInTheDocument();

    fireEvent.change(discount!, { target: { value: '0' } });
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
    expect(screen.getByText('Comment')).toBeInTheDocument();

    // The sibling predicate is the renderer's to decide, not a step error, and
    // the pause never names `note` as a field it hid.
    expect(step?.status).toBe('paused');
    expect(step?.error).toBeUndefined();
    expect(step?.note ?? '').not.toMatch(/"note"/);
  });

  it('docs shape: ticking Create Opportunity reveals Opportunity Name; Plain (no predicate) is drawn throughout', () => {
    const { node, variables, step } = pauseAt(docsShape);
    const { container } = render(<ScreenPreview node={node} variables={variables} />);
    expect(screen.queryByText('Opportunity Name')).not.toBeInTheDocument();
    expect(screen.getByText('Plain')).toBeInTheDocument();
    expect(screen.getByText(/hidden by .*visible when/i)).toBeInTheDocument();

    fireEvent.click(container.querySelector('#ff-createOpportunity')!);
    expect(screen.getByText('Opportunity Name')).toBeInTheDocument();
    expect(screen.getByText('Plain')).toBeInTheDocument();
    expect(screen.queryByText(/hidden by .*visible when/i)).not.toBeInTheDocument();

    expect(step?.error).toBeUndefined();
    expect(step?.note ?? '').not.toMatch(/"opportunityName"/);
  });

  it('docs shape with the flow variable declared (`createOpportunity: false` in the run, as the docs recommend): the tick still reveals the field', () => {
    // This is the shape that froze hardest: the run held `false`, the predicate
    // evaluated false against it, the field was dropped, and the checkbox the
    // author ticked in the preview changed nothing.
    const { node, variables } = pauseAt(docsShape, { createOpportunity: false });
    expect(variables).toEqual({ createOpportunity: false });
    const { container } = render(<ScreenPreview node={node} variables={variables} />);
    expect(screen.queryByText('Opportunity Name')).not.toBeInTheDocument();
    fireEvent.click(container.querySelector('#ff-createOpportunity')!);
    expect(screen.getByText('Opportunity Name')).toBeInTheDocument();
    expect(screen.getByText('Plain')).toBeInTheDocument();
  });
});

describe('the Debug run screen does not read a visibleWhen from the run variables, and names it (objectui#10743)', () => {
  it('the render is the same whether the run holds needsApproval true or false; Plain (no predicate) is drawn in both', () => {
    const t = pauseAt(runVariableShape, { needsApproval: true });
    const withTrue = render(<ScreenPreview node={t.node} variables={t.variables} />);
    const reasonWithTrue = withTrue.queryByText('Reason') !== null;
    expect(withTrue.getByText('Plain')).toBeInTheDocument();
    withTrue.unmount();

    const f = pauseAt(runVariableShape, { needsApproval: false });
    const withFalse = render(<ScreenPreview node={f.node} variables={f.variables} />);
    const reasonWithFalse = withFalse.queryByText('Reason') !== null;
    expect(withFalse.getByText('Plain')).toBeInTheDocument();

    // Scope, not direction: the run variable is not what decides the field.
    expect(reasonWithFalse).toBe(reasonWithTrue);
  });

  it('the screen step names the field whose visibleWhen references a name that is not a field on this screen, whatever the run holds', () => {
    for (const seed of [{}, { needsApproval: true }, { needsApproval: false }]) {
      const { step } = pauseAt(runVariableShape, seed);
      expect(step?.status).toBe('paused');
      expect(step?.error).toMatch(/"reason"/);
      expect(step?.error).toMatch(/needsApproval/);
      expect(step?.error).not.toMatch(/"plain"/);
    }
  });
});
