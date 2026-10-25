/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `process-designer` DRAWS the members objectui#11434 ruled READ.
 *
 * The card's measurement found `ProcessDesignerSchema.version` and `.lanes`,
 * `BPMNNode`'s `properties`, `assignee`, `dueDate` and `script`, and
 * `BPMNEdge`'s `condition` and `isDefault` declared and drawn by nothing:
 * `ProcessDesigner` declared `version` on its props and never destructured it,
 * bound `lanes` to an unused name, and its property panel offered a node's
 * name, type and description alone. The seat ruled each READ — BPMN versions,
 * swim lanes, task assignment, script tasks, conditional and default flows are
 * all mainstream.
 *
 * "Read" is measured the way the card measured "unread": a render probe
 * through the real `SchemaRenderer` and the real registry, one document with
 * the member and one without it, compared as drawn markup, in the initial
 * state and — for the node members, which the property panel draws — with the
 * node selected. On top of that diff, each row names WHAT is drawn.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import type { BPMNNode } from '@object-ui/types';
import { SchemaRenderer } from '@object-ui/react';
import { ProcessDesigner } from '../ProcessDesigner';
import '../index';

type Doc = Record<string, unknown>;

afterEach(() => cleanup());

const START = { id: 'n1', type: 'start-event', label: 'Start', position: { x: 40, y: 40 } };
const APPROVE = { id: 'n2', type: 'user-task', label: 'Approve', position: { x: 240, y: 40 } };
const CHARGE = { id: 'n3', type: 'script-task', label: 'Charge', position: { x: 440, y: 200 } };
const FLOW = { id: 'f1', source: 'n1', target: 'n2' };

function doc(overrides: { root?: Doc; approve?: Doc; charge?: Doc; flow?: Doc } = {}): Doc {
  return {
    type: 'process-designer',
    processName: 'Order Approval',
    nodes: [START, { ...APPROVE, ...overrides.approve }, { ...CHARGE, ...overrides.charge }],
    edges: [{ ...FLOW, ...overrides.flow }],
    ...overrides.root,
  };
}

/** Render, optionally select the node whose label is `select`, and return the container. */
function mount(node: Doc, select?: string): HTMLElement {
  const { container, getAllByText } = render(<SchemaRenderer schema={node as never} />);
  if (select) {
    act(() => {
      fireEvent.click(getAllByText(select)[0]);
    });
  }
  return container;
}

/** The drawn markup, with React's generated ids normalised away. */
function drawn(node: Doc, select?: string): string {
  const html = mount(node, select)
    .innerHTML.replace(/:r[0-9a-z]+:/g, ':rID:')
    .replace(/«r[0-9a-z]+»/g, '«rID»');
  cleanup();
  return html;
}

const byTestId = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`);

/** The control the property panel draws under the label `label`. */
function control(root: ParentNode, label: string): HTMLInputElement | HTMLTextAreaElement | null {
  const panel = root.querySelector('[aria-label="Property panel"]');
  const caption = Array.from(panel?.querySelectorAll('label') ?? []).find((l) => l.textContent === label);
  return (caption?.parentElement?.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null) ?? null;
}

describe('ProcessDesignerSchema members are drawn (objectui#11434)', () => {
  it('`version` is drawn beside the process name in the toolbar', () => {
    expect(drawn(doc({ root: { version: '1.2' } }))).not.toBe(drawn(doc()));
    expect(byTestId(mount(doc({ root: { version: '1.2' } })), 'process-version')?.textContent).toBe('v1.2');
    cleanup();
    // A version already spelled with its `v` is drawn as written.
    expect(byTestId(mount(doc({ root: { version: 'v2' } })), 'process-version')?.textContent).toBe('v2');
    cleanup();
    expect(byTestId(mount(doc()), 'process-version')).toBeNull();
  });

  it('each lane in `lanes` is a band around the nodes `nodeIds` names, labelled with its `label` and `role`', () => {
    const lanes = [{ id: 'sales', label: 'Sales', role: 'Account executive', nodeIds: ['n1', 'n2'] }];
    expect(drawn(doc({ root: { lanes } }))).not.toBe(drawn(doc()));
    const container = mount(doc({ root: { lanes } }));
    const band = byTestId(container, 'process-lane-sales');
    // Start and Approve both sit at y 40 and are 50 tall; the band pads 24.
    expect(band?.querySelector('rect')?.getAttribute('y')).toBe('16');
    expect(band?.querySelector('rect')?.getAttribute('height')).toBe(String(40 + 50 + 24 - 16));
    expect(band?.querySelector('text')?.textContent).toBe('Sales · Account executive');
    expect(byTestId(container, 'process-lane-role-sales')?.textContent).toBe(' · Account executive');
    cleanup();
    // `nodeIds` decides the band: naming the node at y 200 moves it there.
    const moved = mount(doc({ root: { lanes: [{ ...lanes[0], nodeIds: ['n3'] }] } }));
    expect(byTestId(moved, 'process-lane-sales')?.querySelector('rect')?.getAttribute('y')).toBe('176');
    cleanup();
    expect(byTestId(mount(doc()), 'process-lane-sales')).toBeNull();
  });
});

describe('BPMNNode members are drawn in the property panel of the selected node (objectui#11434)', () => {
  it('`assignee` and `dueDate` are drawn on a user task', () => {
    expect(drawn(doc({ approve: { assignee: 'manager' } }), 'Approve')).not.toBe(drawn(doc(), 'Approve'));
    expect(drawn(doc({ approve: { dueDate: 'P2D' } }), 'Approve')).not.toBe(drawn(doc(), 'Approve'));
    const container = mount(doc({ approve: { assignee: 'manager', dueDate: 'P2D' } }), 'Approve');
    expect(control(container, 'Assignee')?.value).toBe('manager');
    expect(control(container, 'Due date')?.value).toBe('P2D');
  });

  it('`script` is drawn on a script task', () => {
    expect(drawn(doc({ charge: { script: 'charge(order)' } }), 'Charge')).not.toBe(drawn(doc(), 'Charge'));
    expect(control(mount(doc({ charge: { script: 'charge(order)' } }), 'Charge'), 'Script')?.value).toBe('charge(order)');
  });

  it('an authored task member is drawn on any node type, so a value is never hidden', () => {
    const container = mount(doc({ charge: { assignee: 'ops' } }), 'Charge');
    expect(control(container, 'Assignee')?.value).toBe('ops');
  });

  it('each entry of `properties` is drawn under its key, with a control for its type', () => {
    const properties = { sla: 2, queue: 'finance', escalate: true, retry: { max: 3 } };
    expect(drawn(doc({ approve: { properties } }), 'Approve')).not.toBe(drawn(doc(), 'Approve'));
    const container = mount(doc({ approve: { properties } }), 'Approve');
    expect(control(container, 'sla')?.getAttribute('type')).toBe('number');
    expect(control(container, 'sla')?.value).toBe('2');
    expect(control(container, 'queue')?.value).toBe('finance');
    expect((control(container, 'escalate') as HTMLInputElement | null)?.checked).toBe(true);
    expect(control(container, 'retry')?.tagName).toBe('TEXTAREA');
    expect(JSON.parse(control(container, 'retry')?.value ?? 'null')).toEqual({ max: 3 });
  });
});

describe('editing a `properties` entry writes it back into the record (objectui#11434)', () => {
  function edit(properties: Record<string, unknown>, label: string, value: string) {
    const onNodesChange = vi.fn();
    const { getAllByText, container } = render(
      <ProcessDesigner
        processName="p"
        nodes={[{ ...(APPROVE as BPMNNode), properties }]}
        edges={[]}
        onNodesChange={onNodesChange}
      />,
    );
    act(() => {
      fireEvent.click(getAllByText('Approve')[0]);
    });
    onNodesChange.mockClear();
    act(() => {
      fireEvent.change(control(container, label) as Element, { target: { value } });
    });
    return onNodesChange;
  }

  it('a number entry commits a number, under its own key', () => {
    const onNodesChange = edit({ sla: 2, queue: 'finance' }, 'sla', '5');
    const nodes = onNodesChange.mock.calls.at(-1)?.[0] as BPMNNode[];
    expect(nodes[0].properties).toEqual({ sla: 5, queue: 'finance' });
  });

  it('a JSON entry commits once it parses, and an edit that does not parse changes nothing', () => {
    const parsed = edit({ retry: { max: 3 } }, 'retry', '{"max":5}');
    expect((parsed.mock.calls.at(-1)?.[0] as BPMNNode[])[0].properties).toEqual({ retry: { max: 5 } });
    cleanup();
    const partial = edit({ retry: { max: 3 } }, 'retry', '{"max":');
    expect(partial).not.toHaveBeenCalled();
  });
});

describe('BPMNEdge members are drawn on the flow (objectui#11434)', () => {
  it('`condition` is drawn on the flow, in brackets', () => {
    expect(drawn(doc({ flow: { condition: 'amount > 0' } }))).not.toBe(drawn(doc()));
    const container = mount(doc({ flow: { condition: 'amount > 0' } }));
    expect(byTestId(container, 'process-edge-condition-f1')?.textContent).toBe('[amount > 0]');
    expect(byTestId(container, 'process-edge-f1')?.querySelector('title')?.textContent).toBe('Condition: amount > 0');
  });

  it('`isDefault` is drawn as the default-flow slash at the flow\'s source', () => {
    expect(drawn(doc({ flow: { isDefault: true } }))).not.toBe(drawn(doc()));
    const container = mount(doc({ flow: { isDefault: true } }));
    const slash = byTestId(container, 'process-edge-default-f1');
    // Start's right edge is x 160 and its centre y 65; the slash crosses there.
    expect([slash?.getAttribute('x1'), slash?.getAttribute('x2')]).toEqual(['168', '176']);
    cleanup();
    expect(byTestId(mount(doc({ flow: { isDefault: false } })), 'process-edge-default-f1')).toBeNull();
  });
});
