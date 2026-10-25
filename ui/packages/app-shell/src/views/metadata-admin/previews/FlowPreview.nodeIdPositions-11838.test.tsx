// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11838 — the enumeration pin that closes the family objectui#11772
 * (a removal left edges naming a gone node), objectui#11827 (a rename left
 * edges) and objectui#11838 (a rename left expression references) belong to:
 * a designer write that leaves a position naming a node id that does not exist.
 *
 * One list of every position that can name a node id — `nodeIdPositions`
 * (`flow-node-refs.ts`): an edge's source and target, a boundary event's host,
 * an expression reference's root. Every designer write that adds, removes or
 * renames a node runs here, through the real canvas and inspector, on a flow
 * that holds every kind of position; after each, NO position names a missing
 * node, and the Problems check finds none.
 *
 * A write either carries every position (`applied`), or is refused and writes
 * nothing (`refused`): a removal of a node that a boundary event's host or an
 * expression root still names has no new id for them to follow, so both
 * removal gestures refuse it, naming each site (`nodeRemovalRefusal`).
 *
 * A new kind of position fails the fixture control until the fixture holds
 * one, and then every write below runs against it; a new write joins `WRITES`
 * with its own gesture. The designer has no duplicate gesture — there is no
 * write that copies a node — so `WRITES` holds none.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

// The engine palette / config-schema reads are stubbed to their offline answer
// and the trigger field catalog to an empty one (the shape
// `FlowPreview.removeNode-11772.test.tsx` uses).
vi.mock('./useFlowNodePalette', async () => {
  const { NODE_PALETTE } = await import('./flow-canvas-parts');
  return {
    useActionConfigSchemas: () => ({}),
    useFlowNodePalette: () => NODE_PALETTE,
  };
});
vi.mock('./useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { t, tFormat } from '../i18n';
import { FlowPreview } from './FlowPreview';
import { FlowInspector } from '../inspectors/FlowInspector';
import { buildFlowProblems } from './flow-problems';
import { flowNodeDisplayName } from './flow-canvas-parts';
import { missingNodePositions, nodeIdPositions, NODE_ID_POSITION_KINDS, type NodeIdPosition } from './flow-node-refs';
import type { MetadataSelection } from '../preview-registry';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(cleanup);

type Draft = Record<string, unknown>;

function Host({ initial, onDraft }: { initial: Draft; onDraft: (d: Draft) => void }) {
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);
  const onPatch = React.useCallback((patch: Record<string, unknown>) => setDraft((d) => ({ ...d, ...patch })), []);
  React.useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <>
      <FlowPreview
        type="flow"
        name={String(initial.name)}
        draft={draft}
        editing
        selection={selection}
        onSelectionChange={setSelection}
        onPatch={onPatch}
        locale="en-US"
      />
      {selection && (
        <FlowInspector
          type="flow"
          name={String(initial.name)}
          draft={draft}
          selection={selection}
          onPatch={onPatch}
          onClearSelection={() => setSelection(null)}
          onSelectionChange={setSelection}
          readOnly={false}
          locale="en-US"
        />
      )}
    </>
  );
}

function mount(initial: Draft) {
  const probe = { draft: initial };
  const onDraft = (d: Draft) => {
    probe.draft = d;
  };
  const utils = render(<Host initial={initial} onDraft={onDraft} />);
  return { probe, ...utils };
}

/**
 * A flow holding every kind of position, each naming the approval `x`: the
 * edges into and out of it, a boundary event on it, and three expression
 * references to its outputs — a decision branch, that branch's edge guard, and
 * a record field's template.
 */
function every(): Draft {
  return {
    name: 'positions_probe',
    label: 'Positions probe',
    type: 'autolaunched',
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'approval', label: 'Approve', config: { approvers: [{ type: 'user', value: 'u1' }] } },
      {
        id: 'd',
        type: 'decision',
        label: 'Approved?',
        config: { conditions: [{ label: 'Yes', expression: "x.decision == 'approve'" }, { label: 'Else', expression: 'true' }] },
      },
      { id: 'c', type: 'create_record', label: 'Log', config: { objectName: 'task', fields: { subject: '{{x.comment}}' } } },
      { id: 'be', type: 'boundary_event', label: 'On error', boundaryConfig: { attachedToNodeId: 'x', eventType: 'error', interrupting: true } },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'x' },
      { id: 'e2', source: 'x', target: 'd' },
      { id: 'e3', source: 'd', target: 'c', condition: "x.decision == 'approve'", label: 'Yes' },
      { id: 'e4', source: 'd', target: 'e', isDefault: true },
      { id: 'e5', source: 'c', target: 'e' },
      { id: 'e6', source: 'be', target: 'e' },
    ],
  };
}

/** The refusal both removal gestures show for `x`, naming each site that still names it. */
const REFUSAL_X = tFormat('engine.inspector.flowNode.removeRefused', 'en-US', {
  id: 'x',
  refs: [
    'be › boundaryConfig.attachedToNodeId: `x`',
    "d › config.conditions[0].expression: `x.decision == 'approve'`",
    'c › config.fields.subject: `{{x.comment}}`',
    "d → c › condition: `x.decision == 'approve'`",
  ].join('; '),
});

function selectCard(container: HTMLElement, nodeId: string) {
  const card = container.querySelector(`[data-node-id="${nodeId}"] [role="button"]`) as HTMLElement;
  expect(card, `node card ${nodeId}`).not.toBeNull();
  fireEvent.click(card);
}

function pickCreateRecord() {
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith('Create record'));
  expect(option, 'the palette offers Create record').toBeDefined();
  fireEvent.click(option!);
}

const alerts = () => screen.queryAllByRole('alert').map((el) => el.textContent ?? '');
const pressDelete = () => fireEvent.keyDown(screen.getByRole('application', { name: 'Flow canvas' }), { key: 'Delete' });
const clickRemove = () => fireEvent.click(screen.getByRole('button', { name: t('engine.inspector.flowNode.remove', 'en-US') }));

/**
 * `applied` — the write changed the draft and carried every position;
 * `refused` — the write changed nothing, and the surface that refused it shows
 * the refusal naming each site.
 */
interface Write {
  /** The gesture, through the real canvas and inspector. */
  run: (container: HTMLElement) => void;
  outcome: 'applied' | 'refused';
}

const WRITES: Record<string, Write> = {
  'add: a node card\'s "Add connected node"': {
    run: (container) => {
      const card = container.querySelector('[data-node-id="c"]') as HTMLElement;
      fireEvent.click(within(card).getByRole('button', { name: t('engine.flowCanvas.addConnected', 'en-US') }));
      pickCreateRecord();
    },
    outcome: 'applied',
  },
  'add: an edge\'s "Insert node here"': {
    run: () => {
      fireEvent.click(screen.getAllByRole('button', { name: t('engine.flowCanvas.insertNode', 'en-US') })[0]);
      pickCreateRecord();
    },
    outcome: 'applied',
  },
  'add: an approval\'s "Add revision loop"': {
    run: () => {
      fireEvent.click(screen.getByRole('button', { name: t('engine.flowCanvas.addReviseLoopShort', 'en-US') }));
    },
    outcome: 'applied',
  },
  'rename: the inspector\'s ID field, on the node every position names': {
    run: (container) => {
      selectCard(container, 'x');
      const id = screen.getByLabelText(t('engine.inspector.flowNode.id', 'en-US'));
      fireEvent.change(id, { target: { value: 'approval' } });
      fireEvent.blur(id);
    },
    outcome: 'applied',
  },
  'remove: the inspector\'s "Remove node", on a node no position names': {
    run: (container) => {
      selectCard(container, 'c');
      clickRemove();
    },
    outcome: 'applied',
  },
  'remove: the canvas Delete key, on a node no position names': {
    run: (container) => {
      selectCard(container, 'c');
      pressDelete();
    },
    outcome: 'applied',
  },
  'remove: the inspector\'s "Remove node", on the node every position names': {
    run: (container) => {
      selectCard(container, 'x');
      clickRemove();
    },
    outcome: 'refused',
  },
  'remove: the canvas Delete key, on the node every position names': {
    run: (container) => {
      selectCard(container, 'x');
      pressDelete();
    },
    outcome: 'refused',
  },
};

/** The Problems row that would name one position, were it left naming a missing node. */
function rowFor(p: NodeIdPosition): string {
  switch (p.kind) {
    case 'edge-source':
      return tFormat('engine.flowValidate.edgeSourceMissing', 'en-US', { source: p.id });
    case 'edge-target':
      return tFormat('engine.flowValidate.edgeTargetMissing', 'en-US', { target: p.id });
    case 'boundary-host':
      return tFormat('engine.flowValidate.boundaryHostMissing', 'en-US', { name: flowNodeDisplayName(p.node, 'en-US'), id: p.nodeId, host: p.id });
    case 'expression-root':
      return tFormat('engine.flowValidate.exprRefNodeMissing', 'en-US', { ref: p.ref.text, id: p.id });
  }
}

function errorRows(draft: Draft): string[] {
  return buildFlowProblems({ nodes: draft.nodes as never, edges: draft.edges as never, variables: [], locale: 'en-US' })
    .filter((p) => p.level === 'error')
    .map((p) => p.message);
}

describe('every designer write runs against the one list of node-id positions (objectui#11838)', () => {
  it('control: the fixture holds every kind of position, and none names a missing node', () => {
    expect(new Set(nodeIdPositions(every()).map((p) => p.kind))).toEqual(new Set(NODE_ID_POSITION_KINDS));
    expect(missingNodePositions(every())).toEqual([]);
    expect(errorRows(every())).toEqual([]);
  });

  for (const [name, write] of Object.entries(WRITES)) {
    it(`${name} — ${write.outcome}`, () => {
      const before = every();
      const { probe, container } = mount(before);
      write.run(container);

      if (write.outcome === 'applied') {
        expect(probe.draft, 'the write changed the draft').not.toBe(before);
        expect(alerts()).not.toContain(REFUSAL_X);
      } else {
        expect(probe.draft, 'a refused write changes nothing').toBe(before);
        expect(alerts(), 'the refusal names each site').toEqual([REFUSAL_X]);
      }

      // After every write, no position names a missing node, and the Problems
      // check names none of the fixture's positions as missing.
      expect(missingNodePositions(probe.draft)).toEqual([]);
      const errors = errorRows(probe.draft);
      for (const p of nodeIdPositions(before)) expect(errors, `${p.kind} ${p.id}`).not.toContain(rowFor(p));
    });
  }

  it("a refusal is not left standing: the canvas's goes once another node is selected, the inspector's with the node", () => {
    const { container } = mount(every());
    selectCard(container, 'x');
    pressDelete();
    expect(alerts()).toEqual([REFUSAL_X]);
    selectCard(container, 'd');
    expect(alerts()).toEqual([]);

    selectCard(container, 'x');
    clickRemove();
    expect(alerts()).toEqual([REFUSAL_X]);
    selectCard(container, 'd');
    expect(alerts()).toEqual([]);
  });
});
