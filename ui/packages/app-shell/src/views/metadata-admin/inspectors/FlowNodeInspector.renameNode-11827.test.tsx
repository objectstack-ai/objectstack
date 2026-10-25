// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11827 — renaming a node in the inspector's ID field.
 *
 * The rename commits on blur or Enter, never per keystroke, so no half-typed
 * id is ever a rename; it is refused inline when the id is taken, empty, or
 * still named by an edge; and when it lands, ONE patch carries the node's new
 * id together with every edge endpoint (and boundary-event host) that named
 * the old one, while the selection follows the node so the inspector stays on
 * it.
 *
 * Driven through the real component under a host that keeps a selection and
 * merges each patch shallowly — the `{ ...d, ...patch }` merge the Studio
 * Automations pillar applies.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { encodeNestedNodeId } from './flow-nested-selection';
import { t, tFormat, type SupportedLocale } from '../i18n';
import type { MetadataSelection } from '../preview-registry';

afterEach(cleanup);

// The node inspectors read the object catalog (`/api/v1/meta/object`); answer
// every read as an absent engine. Installed once for the whole file and never
// torn down, so no read flushed after a test body can reach a real socket
// (the shape `RecordDetailView.approvalDeclaredActions.test.tsx` documents).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

type Draft = Record<string, unknown>;
type Edge = { id?: string; source: string; target: string } & Record<string, unknown>;
type Node = { id: string; type?: string } & Record<string, unknown>;

interface Mounted {
  /** Every patch the inspector handed its host, in order. */
  patches: Array<Record<string, unknown>>;
  /** Every selection the inspector asked its host for, in order. */
  selections: Array<MetadataSelection | null>;
  /** The draft as the host holds it now. */
  draft: () => Draft;
}

function mount(
  initial: Draft,
  select: MetadataSelection,
  { locale = 'en-US', readOnly = false }: { locale?: SupportedLocale; readOnly?: boolean } = {},
): Mounted {
  const out = { patches: [] as Array<Record<string, unknown>>, selections: [] as Array<MetadataSelection | null>, current: initial };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    const [selection, setSelection] = React.useState<MetadataSelection>(select);
    return (
      <FlowNodeInspector
        type="flow"
        name="f"
        draft={draft}
        selection={selection}
        onPatch={(patch) => {
          out.patches.push(patch);
          out.current = { ...out.current, ...patch };
          setDraft((d) => ({ ...d, ...patch }));
        }}
        onClearSelection={() => {}}
        onSelectionChange={(next) => {
          out.selections.push(next);
          if (next) setSelection(next);
        }}
        readOnly={readOnly}
        locale={locale}
      />
    );
  }
  render(<Host />);
  return { patches: out.patches, selections: out.selections, draft: () => out.current };
}

const idField = (locale: SupportedLocale = 'en-US') =>
  screen.getByLabelText(t('engine.inspector.flowNode.id', locale)) as HTMLInputElement;
const typeId = (value: string, locale: SupportedLocale = 'en-US') => fireEvent.change(idField(locale), { target: { value } });
const leaveId = (locale: SupportedLocale = 'en-US') => fireEvent.blur(idField(locale));
const refusal = () => screen.queryByRole('alert')?.textContent ?? null;

const nodesOf = (d: Draft) => d.nodes as Node[];
const edgesOf = (d: Draft) => d.edges as Edge[];

/** Every edge whose endpoint names no node in the draft. */
function danglingEdges(d: Draft): Edge[] {
  const ids = new Set(nodesOf(d).map((n) => n.id));
  return edgesOf(d).filter((e) => !ids.has(e.source) || !ids.has(e.target));
}

/** The card's flow: `s → x → e`. */
function card(): Draft {
  return {
    name: 'f',
    label: 'F',
    type: 'autolaunched',
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'create_record', label: 'Create' },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'in', source: 's', target: 'x' },
      { id: 'out', source: 'x', target: 'e' },
    ],
  };
}

const onX: MetadataSelection = { kind: 'node', id: 'x' };

describe('FlowNodeInspector — a rename carries the edges in the same patch (objectui#11827)', () => {
  it("the card's pin: rename x → renamed in s → x → e — both edges follow in the one patch, nothing dangles", () => {
    const m = mount(card(), onX);
    typeId('renamed');
    leaveId();
    expect(m.patches).toHaveLength(1);
    const [patch] = m.patches;
    expect((patch.nodes as Node[]).map((n) => n.id)).toEqual(['s', 'renamed', 'e']);
    expect(patch.edges).toEqual([
      { id: 'in', source: 's', target: 'renamed' },
      { id: 'out', source: 'renamed', target: 'e' },
    ]);
    expect(danglingEdges(m.draft())).toEqual([]);
  });

  it('Enter commits the same rename', () => {
    const m = mount(card(), onX);
    typeId('renamed');
    fireEvent.keyDown(idField(), { key: 'Enter' });
    expect(m.patches).toHaveLength(1);
    expect(edgesOf(m.draft()).map((e) => `${e.source}->${e.target}`)).toEqual(['s->renamed', 'renamed->e']);
  });

  it('typing r, re, ren writes nothing; leaving the field writes the finished id once', () => {
    const m = mount(card(), onX);
    for (const partial of ['r', 're', 'ren']) {
      typeId(partial);
      expect(m.patches, `after typing ${partial}`).toEqual([]);
      expect(idField().value).toBe(partial);
    }
    leaveId();
    expect(m.patches).toHaveLength(1);
    expect(nodesOf(m.draft()).map((n) => n.id)).toEqual(['s', 'ren', 'e']);
  });

  it('the selection follows the renamed node, so the inspector stays on it', () => {
    const m = mount(card(), onX);
    typeId('renamed');
    leaveId();
    expect(m.selections).toEqual([{ kind: 'node', id: 'renamed', label: 'Create' }]);
    expect(idField().value).toBe('renamed');
    expect(screen.getByLabelText(t('engine.inspector.flowNode.label', 'en-US'))).toHaveValue('Create');
  });

  it("keeps every edge's id, guard, label, default flag, type and order — only the endpoints move", () => {
    const draft: Draft = {
      nodes: [
        { id: 'd', type: 'decision' },
        { id: 'x', type: 'create_record' },
        { id: 'y', type: 'create_record' },
        { id: 'e', type: 'end' },
      ],
      edges: [
        { id: 'big', source: 'd', target: 'x', condition: 'amount > 100', label: 'Big' },
        { id: 'else', source: 'd', target: 'y', isDefault: true },
        { id: 'x-e', source: 'x', target: 'e' },
        { id: 'again', source: 'x', target: 'd', type: 'back' },
        { id: 'y-e', source: 'y', target: 'e' },
      ],
    };
    const m = mount(draft, onX);
    typeId('big_path');
    leaveId();
    expect(m.patches[0].edges).toEqual([
      { id: 'big', source: 'd', target: 'big_path', condition: 'amount > 100', label: 'Big' },
      { id: 'else', source: 'd', target: 'y', isDefault: true },
      { id: 'x-e', source: 'big_path', target: 'e' },
      { id: 'again', source: 'big_path', target: 'd', type: 'back' },
      { id: 'y-e', source: 'y', target: 'e' },
    ]);
  });

  it('a boundary event attached to the renamed node stays attached to it', () => {
    const draft: Draft = {
      ...card(),
      nodes: [
        ...(card().nodes as Node[]),
        { id: 'b', type: 'boundary_event', label: 'On error', boundaryConfig: { attachedToNodeId: 'x', eventType: 'error', interrupting: true } },
      ],
    };
    const m = mount(draft, onX);
    typeId('renamed');
    leaveId();
    expect(nodesOf(m.draft()).find((n) => n.id === 'b')?.boundaryConfig).toEqual({
      attachedToNodeId: 'renamed',
      eventType: 'error',
      interrupting: true,
    });
  });

  it('while another node still carries the old id, the edges are that node’s and stay', () => {
    const draft: Draft = {
      nodes: [
        { id: 's', type: 'start' },
        { id: 'x', type: 'create_record', label: 'first' },
        { id: 'x', type: 'create_record', label: 'second' },
      ],
      edges: [{ id: 'in', source: 's', target: 'x' }],
    };
    const m = mount(draft, onX);
    typeId('y');
    leaveId();
    expect(nodesOf(m.draft()).map((n) => n.id)).toEqual(['s', 'y', 'x']);
    expect(edgesOf(m.draft())).toEqual([{ id: 'in', source: 's', target: 'x' }]);
  });

  it('control: editing the label leaves edges untouched — the patch carries no edges', () => {
    const m = mount(card(), onX);
    fireEvent.change(screen.getByLabelText(t('engine.inspector.flowNode.label', 'en-US')), { target: { value: 'Create ticket' } });
    expect(m.patches).toHaveLength(1);
    expect('edges' in m.patches[0]).toBe(false);
    expect(edgesOf(m.draft())).toEqual(edgesOf(card()));
  });
});

describe('FlowNodeInspector — a rename that cannot land is refused inline, and nothing is written (objectui#11827)', () => {
  it('an id another node already has: refused, the field shows the stored id again, the draft is unchanged', () => {
    const m = mount(card(), onX);
    typeId('s');
    leaveId();
    expect(m.patches).toEqual([]);
    expect(refusal()).toBe(tFormat('engine.inspector.flowNode.idTaken', 'en-US', { id: 's' }));
    expect(idField().value).toBe('x');
    expect(idField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('an id a node inside a container region has — one id space for the whole flow', () => {
    const draft: Draft = {
      ...card(),
      nodes: [
        ...(card().nodes as Node[]),
        {
          id: 'sweep',
          type: 'loop',
          label: 'Sweep',
          config: { collection: '{items}', iteratorVariable: 'item', body: { nodes: [{ id: 'inner', type: 'assignment', label: 'Inner' }], edges: [] } },
        },
      ],
    };
    const m = mount(draft, onX);
    typeId('inner');
    fireEvent.keyDown(idField(), { key: 'Enter' });
    expect(m.patches).toEqual([]);
    expect(refusal()).toBe(tFormat('engine.inspector.flowNode.idTaken', 'en-US', { id: 'inner' }));
  });

  it('an empty id', () => {
    const m = mount(card(), onX);
    typeId('');
    leaveId();
    expect(m.patches).toEqual([]);
    expect(refusal()).toBe(t('engine.inspector.flowNode.idRequired', 'en-US'));
    expect(idField().value).toBe('x');
  });

  it('an id an edge still names although no node has it — the rename would pick that edge up', () => {
    const draft: Draft = { ...card(), edges: [...edgesOf(card()), { id: 'stale', source: 's', target: 'ghost' }] };
    const m = mount(draft, onX);
    typeId('ghost');
    leaveId();
    expect(m.patches).toEqual([]);
    expect(refusal()).toBe(tFormat('engine.inspector.flowNode.idEdgeNamed', 'en-US', { id: 'ghost' }));
  });

  it('the refusal goes away when the author edits the id again, and a good id then lands', () => {
    const m = mount(card(), onX);
    typeId('s');
    leaveId();
    expect(refusal()).not.toBeNull();
    typeId('renamed');
    expect(refusal()).toBeNull();
    leaveId();
    expect(m.patches).toHaveLength(1);
  });

  it('Escape puts the stored id back, and leaving the field then writes nothing', () => {
    const m = mount(card(), onX);
    typeId('nope');
    fireEvent.keyDown(idField(), { key: 'Escape' });
    expect(idField().value).toBe('x');
    leaveId();
    expect(m.patches).toEqual([]);
  });

  it('an Enter that ends an IME composition is not a commit', () => {
    const m = mount(card(), onX, { locale: 'zh-CN' });
    typeId('审批', 'zh-CN');
    fireEvent.keyDown(idField('zh-CN'), { key: 'Enter', isComposing: true });
    expect(m.patches).toEqual([]);
  });

  it('zh-CN: the refusal reads in the designer locale', () => {
    mount(card(), onX, { locale: 'zh-CN' });
    typeId('s', 'zh-CN');
    leaveId('zh-CN');
    const zh = tFormat('engine.inspector.flowNode.idTaken', 'zh-CN', { id: 's' });
    expect(zh).not.toBe(tFormat('engine.inspector.flowNode.idTaken', 'en-US', { id: 's' }));
    expect(refusal()).toBe(zh);
  });

  it('read-only: the field is disabled', () => {
    mount(card(), onX, { readOnly: true });
    expect(idField()).toBeDisabled();
  });

  it("a nested node's id stays read-only", () => {
    const draft: Draft = {
      nodes: [
        {
          id: 'sweep',
          type: 'loop',
          label: 'Sweep',
          config: { collection: '{items}', iteratorVariable: 'item', body: { nodes: [{ id: 'inner', type: 'assignment', label: 'Inner' }], edges: [] } },
        },
      ],
      edges: [],
    };
    mount(draft, { kind: 'nested-node', id: encodeNestedNodeId({ containerId: 'sweep', regionKey: 'body', nodeId: 'inner' }) });
    expect(idField()).toBeDisabled();
    expect(idField().value).toBe('inner');
  });
});
