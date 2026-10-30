// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27834 — on a record-triggered flow a new Update Records node
 * starts on the trigger's object.
 *
 * The seed is written where the node is CREATED (`defaultNodeExtras`, spread
 * by `FlowCanvas.addNode` / `insertOnEdge`), never when an existing node is
 * opened: a stored config is the author's and is left as it stands. Driven
 * through the "+" a user clicks, and the emitted node is parsed whole against
 * the spec's own node schema. Other node types, and a flow whose start is not
 * a record trigger, seed what they always did.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Automation from '@objectstack/spec/automation';
import { FlowCanvas } from './FlowCanvas';
import { defaultNodeExtras } from './flow-canvas-parts';

afterEach(cleanup);

// The palette hook's GET of the engine's action list, answered "engine absent".
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(String(url)).toBe('/api/v1/automation/actions');
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface ZodLike {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: unknown[] } };
}
const FlowNodeSchema = (Automation as unknown as Record<string, ZodLike>).FlowNodeSchema;

const recordStart = (objectName: string, triggerType = 'record-after-update') => ({
  id: 'start',
  type: 'start',
  label: 'Start',
  config: { triggerType, objectName },
});

/** Add a node of the palette row `label` after Start; the node the patch adds. */
function addAfterStart(nodes: Array<Record<string, unknown>>, label: string): Record<string, unknown> {
  const patches: Array<Record<string, unknown>> = [];
  render(
    <FlowCanvas
      nodes={nodes as never}
      edges={[]}
      editable
      designMode
      selectedId={null}
      onSelect={() => {}}
      onPatch={(partial) => patches.push(partial)}
    />,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Add connected node' })[0]);
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith(label));
  expect(option, `palette row ${label}`).toBeDefined();
  fireEvent.click(option!);
  expect(patches).toHaveLength(1);
  const added = (patches[0]!.nodes as Array<Record<string, unknown>>).find((n) => n.id !== 'start');
  expect(added).toBeDefined();
  return added!;
}

describe('objectstack#27834 — a new Update Records node starts on the trigger object', () => {
  it('the + on a record-triggered flow seeds config.objectName with the trigger object, and the node parses', () => {
    const added = addAfterStart([recordStart('ticket')], 'Update record');
    expect(added.type).toBe('update_record');
    expect(added.config).toEqual({ objectName: 'ticket' });
    expect(FlowNodeSchema.safeParse(added).success).toBe(true);
  });

  it('control: a flow whose start is not a record trigger seeds no object', () => {
    const added = addAfterStart([{ id: 'start', type: 'start', label: 'Start', config: { triggerType: 'manual' } }], 'Update record');
    expect(added.type).toBe('update_record');
    expect(added.config).toBeUndefined();
  });

  it('control: other node types seed what they always did on the same flow', () => {
    const nodes = [recordStart('ticket')];
    for (const type of ['create_record', 'delete_record', 'get_record', 'http', 'notify']) {
      expect(defaultNodeExtras(type, nodes), type).toEqual(defaultNodeExtras(type));
    }
  });

  it('every record trigger seeds; a record trigger with no object seeds nothing', () => {
    for (const triggerType of ['record-after-create', 'record-after-write', 'record-before-write', 'record-before-update', 'record-after-delete']) {
      expect(defaultNodeExtras('update_record', [recordStart('ticket', triggerType)]), triggerType).toEqual({ config: { objectName: 'ticket' } });
    }
    expect(defaultNodeExtras('update_record', [recordStart('')])).toEqual({});
    expect(defaultNodeExtras('update_record')).toEqual({});
  });
});
