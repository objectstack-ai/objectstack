// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11842 — a flow node's object input suggests no object of another
 * app.
 *
 * Eight object inputs in the flow config table carried a placeholder naming an
 * example object of some other app (`contract`, `contracts`, `crm_account`,
 * `showcase_task`). An author reads a placeholder as a suggestion, and in an
 * app without that object the suggestion names something that will not
 * resolve. Every one of these inputs is a `reference` of kind `object`, which
 * renders through the shared object picker (objectui#11783): its list already
 * offers the objects the app does have, so the placeholders were dropped, not
 * replaced.
 *
 * Read through the RENDERED inspector — a real `FlowNodeInspector` over a node
 * of each type — not the descriptor table, so a placeholder that reached the
 * input any other way would show here too. Nothing is stubbed but the engine
 * palette hook (no server field set, so the hand-written groups render) and the
 * metadata client.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));

const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [
    { name: 'repairs_repair_ticket', label: 'Repair Ticket', _packageId: 'com.example.repairs' },
  ];
  const client = {
    get: vi.fn(async () => null),
    withPreviewDrafts: vi.fn((_on: boolean) => ({ list: vi.fn(async () => CATALOG) })),
    list: vi.fn(async (type: string) => (type === 'object' ? CATALOG : [])),
    listDrafts: vi.fn(async () => [] as unknown[]),
  };
  return { client };
});

vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { FlowNodeInspector } from './FlowNodeInspector';

afterEach(cleanup);
beforeAll(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

/** The example objects of other apps the eight inputs named before this card. */
const FOREIGN_OBJECTS = ['contract', 'contracts', 'crm_account', 'showcase_task', 'crm_lead'];

function renderNode(type: string, config: Record<string, unknown> = {}) {
  render(
    <FlowNodeInspector
      type="flow"
      name="repairs_ticket_flow"
      draft={{ nodes: [{ id: 'n1', type, label: 'Node', config }], edges: [] }}
      selection={{ kind: 'node', id: 'n1' }}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
}

/**
 * Each listed field: the node that shows it, the config that makes it visible,
 * and the accessible name its object picker carries (the field's label).
 */
const OBJECT_INPUTS: Array<{ node: string; config?: Record<string, unknown>; label: string }> = [
  { node: 'start', config: { triggerType: 'time_relative' }, label: 'Sweep object' },
  { node: 'map', label: 'Item object' },
  { node: 'create_record', label: 'Object' },
  { node: 'update_record', label: 'Object' },
  { node: 'delete_record', label: 'Object' },
  { node: 'get_record', label: 'Object' },
  { node: 'screen', label: 'Object form' },
  { node: 'action', label: 'Object' },
];

describe('a flow node’s object input suggests no object of another app (objectui#11842)', () => {
  it.each(OBJECT_INPUTS)('$node — *$label* names no foreign object as its placeholder', ({ node, config, label }) => {
    renderNode(node, config);
    const input = screen.getByRole('combobox', { name: label });
    const placeholder = input.getAttribute('placeholder');
    expect(
      FOREIGN_OBJECTS.filter((name) => (placeholder ?? '').split(/[^a-z_]+/).includes(name)),
      `${node} → ${label}: placeholder ${JSON.stringify(placeholder)}`,
    ).toEqual([]);
    // The shape chosen: no placeholder at all. The picker's own list offers
    // the objects the app has; an empty input names none of its own.
    expect(placeholder, `${node} → ${label}`).toBeNull();
  });

  // Control: an input on the same panels whose placeholder is not an object
  // name keeps it. True before this card and after it.
  it.each([
    { node: 'start', config: { triggerType: 'time_relative' }, placeholder: 'end_date' },
    { node: 'map', placeholder: 'item' },
    { node: 'create_record', placeholder: 'newRecord' },
    { node: 'get_record', placeholder: '100' },
    { node: 'get_record', placeholder: 'records' },
    { node: 'screen', placeholder: 'account_id' },
    { node: 'action', placeholder: 'record.id' },
  ])('$node — an input whose placeholder is not an object name keeps `$placeholder`', ({ node, config, placeholder }) => {
    renderNode(node, config);
    expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
  });
});
