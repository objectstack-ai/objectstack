// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34796 — the flow node panel leads with what the author named the
 * node, keeps machine names out of its text, and puts "Remove node" in the
 * header's "···" menu.
 *
 * - The first labelled control is the node's Label; its id is in a "Developer
 *   info" section that starts collapsed.
 * - The object a CRUD node writes is named by its label in every sentence, and
 *   the object picker keeps the machine name on its hover title.
 * - There is no footer remove button; the header menu's item makes the same
 *   removal the footer button made, and the canvas's Delete key still makes it.
 * - Under a host that frames the inspector (Studio's automation aside), the
 *   menu is drawn into the element the host names in its own title bar.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));

const h = vi.hoisted(() => {
  const NAME = 'repairs_repair_ticket';
  const CATALOG: Array<Record<string, unknown>> = [
    { name: NAME, label: 'Repair Ticket', _packageId: 'com.example.repairs' },
  ];
  const get = vi.fn(async (_type: string, name: string) =>
    name === NAME ? { name, label: 'Repair Ticket', fields: { status: { type: 'text', label: 'Status' } } } : null,
  );
  const previewList = vi.fn(async (_type: string) => CATALOG);
  const client = {
    get,
    withPreviewDrafts: vi.fn((_on: boolean) => ({ list: previewList, get })),
    list: vi.fn(async (type: string) => (type === 'object' ? CATALOG : [])),
    listDrafts: vi.fn(async () => [] as unknown[]),
  };
  return { NAME, client };
});

vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { FlowNodeInspector } from './FlowNodeInspector';
import { InspectorShellHostProvider } from './_shared';
import { FlowCanvas } from '../previews/FlowCanvas';
import { edgesAfterNodeRemoval } from '../previews/flow-problems';
import { t } from '../i18n';

afterEach(cleanup);
beforeAll(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

const EN = 'en-US';
const NODE_ID = 'node_1';

type Node = { id: string; type: string; label?: string; config?: Record<string, unknown> };

/** A record-triggered flow: start → update the triggering ticket → end. */
function flow(): { nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> } {
  return {
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-create', objectName: h.NAME } },
      { id: NODE_ID, type: 'update_record', label: 'Update ticket', config: { objectName: h.NAME } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: NODE_ID },
      { id: 'e2', source: NODE_ID, target: 'end' },
    ],
  };
}

function renderInspector(opts: { onPatch?: (p: Record<string, unknown>) => void; onClear?: () => void; readOnly?: boolean } = {}) {
  return render(
    <FlowNodeInspector
      type="flow"
      name="repairs_ticket_flow"
      draft={flow() as unknown as Record<string, unknown>}
      selection={{ kind: 'node', id: NODE_ID }}
      onPatch={opts.onPatch ?? vi.fn()}
      onClearSelection={opts.onClear ?? vi.fn()}
      readOnly={opts.readOnly ?? false}
      locale={EN}
    />,
  );
}

/** Open the header's "···" menu and press its remove item. */
function pressMenuRemove() {
  fireEvent.pointerDown(screen.getByRole('button', { name: t('engine.inspector.flowNode.moreActions', EN) }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole('menuitem', { name: t('engine.inspector.flowNode.remove', EN) }));
}

describe('the node panel leads with its label (objectstack#34796)', () => {
  it('draws Label as the first labelled control and the id only inside a collapsed Developer info', () => {
    const { container } = renderInspector();
    const labels = [...container.querySelectorAll('label')].map((l) => l.textContent?.trim());
    expect(labels[0]).toBe(t('engine.inspector.flowNode.label', EN));

    const idInput = screen.getByDisplayValue(NODE_ID);
    const section = screen.getByTestId('flow-node-developer-info') as HTMLDetailsElement;
    expect(section.tagName).toBe('DETAILS');
    expect(section.open).toBe(false);
    expect(section.contains(idInput)).toBe(true);
    expect(section.querySelector('summary')?.textContent).toBe(t('engine.inspector.flowNode.developerInfo', EN));
    // Nothing outside that section names the id.
    const outside = [...container.querySelectorAll('input')].filter((i) => !section.contains(i)).map((i) => i.value);
    expect(outside).not.toContain(NODE_ID);
  });

  it('names the object by its label and keeps the machine name on the picker hover title only', async () => {
    const { container } = renderInspector();
    await waitFor(() =>
      expect(screen.getByTestId('flow-triggering-record-target').textContent).toContain('“Repair Ticket”'),
    );
    expect(container.textContent).not.toContain(h.NAME);
    expect(container.querySelector('[data-object-name-line]')).toBeNull();
    const picker = screen.getByRole('combobox', { name: /object/i });
    expect(picker).toHaveValue('Repair Ticket');
    expect(picker).toHaveAttribute('title', h.NAME);
  });
});

describe('Remove node lives in the header menu (objectstack#34796)', () => {
  it('draws no remove button in the panel; the menu item makes the removal the footer made', () => {
    const onPatch = vi.fn();
    const onClear = vi.fn();
    renderInspector({ onPatch, onClear });
    expect(screen.queryByRole('button', { name: t('engine.inspector.flowNode.remove', EN) })).toBeNull();

    pressMenuRemove();
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0] as { nodes: Node[]; edges: unknown[] };
    const draft = flow();
    expect(patch.nodes.map((n) => n.id)).toEqual(['start', 'end']);
    expect(patch.edges).toEqual(edgesAfterNodeRemoval(draft.edges as never, NODE_ID, new Set(['start', 'end'])));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables the menu on a read-only panel, so nothing can be removed', () => {
    const onPatch = vi.fn();
    renderInspector({ onPatch, readOnly: true });
    const trigger = screen.getByRole('button', { name: t('engine.inspector.flowNode.moreActions', EN) });
    expect(trigger).toBeDisabled();
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.queryByRole('menuitem', { name: t('engine.inspector.flowNode.remove', EN) })).toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('control: the canvas Delete key still removes the selected node, as the menu item does', () => {
    const onPatch = vi.fn();
    const draft = flow();
    render(
      <FlowCanvas
        nodes={draft.nodes as never}
        edges={draft.edges as never}
        editable
        designMode
        selectedId={NODE_ID}
        onSelect={() => {}}
        onPatch={onPatch}
      />,
    );
    fireEvent.keyDown(screen.getByRole('application', { name: t('engine.flowCanvas.canvas', EN) }), { key: 'Delete' });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0] as { nodes: Node[]; edges: unknown[] };
    expect(patch.nodes.map((n) => n.id)).toEqual(['start', 'end']);
    expect(patch.edges).toEqual(edgesAfterNodeRemoval(draft.edges as never, NODE_ID, new Set(['start', 'end'])));
  });

  it('draws the menu into the title-bar element a framing host names', () => {
    function Host() {
      const [slot, setSlot] = React.useState<HTMLElement | null>(null);
      return (
        <div>
          <header>
            <span data-testid="host-title-bar" ref={setSlot} />
          </header>
          <InspectorShellHostProvider value={{ headerActionsTarget: slot }}>
            <FlowNodeInspector
              type="flow"
              name="repairs_ticket_flow"
              draft={flow() as unknown as Record<string, unknown>}
              selection={{ kind: 'node', id: NODE_ID }}
              onPatch={vi.fn()}
              onClearSelection={vi.fn()}
              readOnly={false}
              locale={EN}
            />
          </InspectorShellHostProvider>
        </div>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: t('engine.inspector.flowNode.moreActions', EN) });
    expect(screen.getByTestId('host-title-bar').contains(trigger)).toBe(true);
    expect(screen.getByTestId('inspector-shell-hosted').contains(trigger)).toBe(false);
  });
});
