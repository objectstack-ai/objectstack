// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11783 — the flow trigger's *Object* resolves the name the author
 * COMMITS, never each prefix they type on the way to it.
 *
 * The whole inspector, from a real start node: `FlowNodeInspector` asks
 * `useFlowScope` for the trigger's field vocabulary and the entry-condition
 * builder reads the same object, both through the real `useObjectFields`,
 * which reads it with `client.get('object', NAME)` — the `GET /meta/object/NAME`
 * the card measured about twice per keystroke. Nothing is stubbed but the
 * engine palette hook and the metadata client, so the count read here is the
 * count of that request.
 *
 * The client double also answers the published list the old input read, so
 * the reverse check runs the old input to its measurement.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));

const h = vi.hoisted(() => {
  const NAME = 'repairs_repair_ticket';
  const CATALOG: Array<Record<string, unknown>> = [
    { name: NAME, label: 'Repair Ticket', _packageId: 'com.example.repairs' },
    { name: 'sys_user', label: 'User', isSystem: true, _packageId: 'com.objectstack.plugin-auth' },
  ];
  const get = vi.fn(async (_type: string, name: string) =>
    name === NAME ? { name, fields: { status: { type: 'text', label: 'Status' } } } : null,
  );
  const previewList = vi.fn(async (_type: string) => CATALOG);
  const client = {
    get,
    withPreviewDrafts: vi.fn((_on: boolean) => ({ list: previewList, get })),
    list: vi.fn(async (type: string) => (type === 'object' ? CATALOG : [])),
    listDrafts: vi.fn(async () => [] as unknown[]),
  };
  return { NAME, get, client };
});

vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { FlowNodeInspector } from './FlowNodeInspector';

afterEach(cleanup);
beforeEach(() => h.get.mockClear());
beforeAll(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

type Node = { id: string; type: string; label?: string; config?: Record<string, unknown> };

/** The inspector over a record-triggered flow that takes its own patches. */
function Harness({ onPatch }: { onPatch: (p: Record<string, unknown>) => void }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    nodes: [{ id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-create' } }],
    edges: [],
  });
  return (
    <FlowNodeInspector
      type="flow"
      name="repairs_ticket_flow"
      draft={draft}
      selection={{ kind: 'node', id: 'start' }}
      onPatch={(p) => {
        onPatch(p);
        setDraft((d) => ({ ...d, ...p }));
      }}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />
  );
}

/**
 * The input under the trigger's visible *Object* label, located by the label's
 * container so the reverse check finds the old datalist input too.
 */
function triggerObjectInput(): HTMLInputElement {
  return screen.getByText('Object', { selector: 'label' }).parentElement!.querySelector('input')!;
}

/** The trigger object each patch wrote, in order. */
function committedObjects(onPatch: ReturnType<typeof vi.fn>): unknown[] {
  return onPatch.mock.calls
    .map(([p]) => (p as { nodes?: Node[] }).nodes?.find((n) => n.id === 'start')?.config?.objectName)
    .filter((v) => v !== undefined);
}

const objectGets = () => h.get.mock.calls.filter(([type]) => type === 'object').map(([, name]) => name);

describe('Flow trigger Object — resolves the committed name only (objectui#11783)', () => {
  it('typing a name issues no object read; committing it reads that name only', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    const input = triggerObjectInput();

    await userEvent.click(input);
    await userEvent.type(input, h.NAME);
    expect(objectGets()).toEqual([]);
    expect(committedObjects(onPatch)).toEqual([]);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(objectGets().length).toBeGreaterThan(0));
    // Each reader of the trigger object resolves it once — for the committed name.
    expect(new Set(objectGets())).toEqual(new Set([h.NAME]));
    expect(committedObjects(onPatch)).toEqual([h.NAME]);
  });

  // Control: true before this card and after it — the accepted values did not change.
  it('still accepts a value that names no object (an expression), exactly as typed', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    const input = triggerObjectInput();
    await userEvent.click(input);
    // `{{` is user-event's escape for one literal `{`.
    await userEvent.type(input, '{{{{trigger.object}}');
    await userEvent.keyboard('{Enter}');
    expect(committedObjects(onPatch).at(-1)).toBe('{{trigger.object}}');
  });

  it('names no example object of its own (no `crm_lead` placeholder)', () => {
    render(<Harness onPatch={vi.fn()} />);
    expect(triggerObjectInput().getAttribute('placeholder') ?? '').not.toContain('crm_lead');
  });
});
