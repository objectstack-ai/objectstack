// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The whole inspector, not just the field** (objectui#6226).
 *
 * `FlowNodeConfigField.entryCondition.test.tsx` next door measures the field
 * with a `TriggerScope` the test resolves itself. That leaves exactly one link
 * of the chain unmeasured — whether `FlowNodeInspector` actually ASKS
 * `useFlowScope` for that vocabulary and hands it down. A wiring that forgot the
 * prop would pass every assertion over there and ship a flow designer that still
 * renders a one-line CEL box.
 *
 * So this file selects a start node in the real inspector, from a real draft,
 * and asks what an author sees. Nothing is stubbed except the two hooks that
 * would otherwise hit the network (the engine config-schema publisher and the
 * object field catalog) — the same stubs the sibling FlowNodeInspector suites
 * use.
 *
 * The scope is resolved by the inspector itself, from the draft's own
 * `triggerType` / `objectName`, which is what makes the two negative cases below
 * measurements rather than restatements: the same inspector, the same field,
 * a different trigger, a different control.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The engine config-schema hook is stubbed empty so the inspector uses its
// hardcoded field groups (fieldsForNodeType); the trigger field catalog is
// stubbed so useFlowScope and ConditionBuilder resolve without a network client.
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
const FIELDS = vi.hoisted(() => [
  { name: 'status', label: 'Status', type: 'text', hidden: false },
  { name: 'amount', label: 'Amount', type: 'number', hidden: false },
]);
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: FIELDS, loading: false, error: null }),
}));
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

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

/** A record-triggered flow whose start node already holds a shipped-shape entry
 *  condition. `record-after-write` fires on create OR update, so `previous` is
 *  bound at this gate. */
function draftWith(config: Record<string, unknown>) {
  return { nodes: [{ id: 'start', type: 'start', label: 'When a lead changes', config }], edges: [] };
}

function renderStartNode(config: Record<string, unknown>) {
  const onPatch = vi.fn();
  const { container } = render(
    <FlowNodeInspector
      type="flow"
      name="renewal"
      draft={draftWith(config)}
      selection={{ kind: 'node', id: 'start' }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { container, onPatch };
}

const RECORD_TRIGGER = { triggerType: 'record-after-write', objectName: 'crm_lead' };

/** Row-mode markers, read off the whole inspector. In row mode the condition
 *  editor mounts an `Expression` toggle and one remove button per parsed row;
 *  in raw mode a `Builder` toggle and no rows; pre-#6226 it mounted neither. */
function modeOf(container: HTMLElement) {
  const buttons = Array.from(container.querySelectorAll('button'));
  return {
    builderToggle: buttons.some((b) => b.textContent?.includes('Builder')),
    expressionToggle: buttons.some((b) => b.textContent?.includes('Expression')),
    rows: container.querySelectorAll('[aria-label="Remove condition"]').length,
  };
}

describe('#6226 the flow inspector hands the entry condition its trigger vocabulary', () => {
  it('a start node with a stored entry condition opens in ROW mode', () => {
    const { container } = renderStartNode({
      ...RECORD_TRIGGER,
      condition: 'status == "done" && previous.status != "done"',
    });
    // The field is the one the card names.
    expect(screen.getByText('Entry condition')).toBeInTheDocument();
    const m = modeOf(container);
    expect(m.expressionToggle).toBe(true);
    expect(m.builderToggle).toBe(false);
    expect(m.rows).toBe(2);
  });

  it('its subject dropdown offers the FLATTENED vocabulary the inspector resolved', async () => {
    const { container } = renderStartNode({ ...RECORD_TRIGGER, condition: 'status == "done"' });
    // The first combobox belongs to the `triggerType` select; the condition
    // editor's subject select is the one inside the row. Find it by the row.
    const row = container.querySelector('[aria-label="Remove condition"]')!.closest('div')!
      .parentElement!;
    const subject = row.querySelector('[role="combobox"]') as HTMLElement;
    await userEvent.click(subject);
    const opts = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
    expect(opts).toContain('status');
    expect(opts).toContain('previous.status');
    // One subject per value: the bare spelling, never `record.FIELD` beside it
    // (the engine binds both at this gate, objectui#11789).
    expect(opts).not.toContain('record.id');
    expect(opts.filter((o) => o.startsWith('record.'))).toEqual([]);
  });

  it('a SCHEDULE trigger keeps the raw input — no record bound, no vocabulary to declare', () => {
    const { container } = renderStartNode({
      triggerType: 'schedule',
      objectName: 'crm_lead',
      condition: 'status == "done"',
    });
    expect(screen.getByText('Entry condition')).toBeInTheDocument();
    const m = modeOf(container);
    expect(m.expressionToggle).toBe(false);
    expect(m.builderToggle).toBe(false);
    expect(m.rows).toBe(0);
  });

  it('a record trigger with NO object keeps the raw input', () => {
    // `resolveFlowScope` needs an objectName before it will declare a trigger
    // vocabulary; a half-authored start node must not get a builder over a
    // catalog that does not exist.
    const { container } = renderStartNode({
      triggerType: 'record-after-update',
      condition: 'status == "done"',
    });
    const m = modeOf(container);
    expect(m.expressionToggle).toBe(false);
    expect(m.builderToggle).toBe(false);
  });

  it('editing a row writes the compiled CEL back to config.condition', async () => {
    const { container, onPatch } = renderStartNode({
      ...RECORD_TRIGGER,
      condition: 'status == "done"',
    });
    const valueBox = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === 'done',
    ) as HTMLInputElement;
    expect(valueBox).toBeTruthy();
    await userEvent.clear(valueBox);
    await userEvent.type(valueBox, 'shipped');
    const patch = onPatch.mock.calls.at(-1)![0] as { nodes: Array<{ config: { condition: string } }> };
    // Same key, same CEL dialect, same double quotes the author had — the
    // ruling's "compiled output stays the CEL the runtime already evaluates".
    expect(patch.nodes[0].config.condition).toBe('status == "shipped"');
  });
});

describe('#6226 the OTHER expression fields in the same inspector are untouched', () => {
  it('a decision node\'s Branches repeater still renders its objectList cells', () => {
    // Branch conditions are `expression`-kind COLUMNS inside an objectList, a
    // different component with a different commit protocol. They are Q2, ruled
    // out of this card — pinned here so "wire every expression field" cannot
    // pass as this change.
    const onPatch = vi.fn();
    const { container } = render(
      <FlowNodeInspector
        type="flow"
        name="renewal"
        draft={{
          nodes: [
            { id: 'start', type: 'start', config: RECORD_TRIGGER },
            { id: 'decide', type: 'decision', config: { conditions: [{ label: 'Big', expression: 'amount > 100' }] } },
          ],
          edges: [{ source: 'start', target: 'decide' }],
        }}
        selection={{ kind: 'node', id: 'decide' }}
        onPatch={onPatch}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="en-US"
      />,
    );
    // The branch's expression is still an editable cell, not a row builder.
    expect(screen.getByDisplayValue('amount > 100')).toBeInTheDocument();
    expect(modeOf(container).rows).toBe(0);
  });
});
